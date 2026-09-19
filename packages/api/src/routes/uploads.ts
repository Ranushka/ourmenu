import { Router } from 'express';
import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const CHUNKS_DIR = path.join(UPLOADS_DIR, '.chunks');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CHUNKS_DIR, { recursive: true });

function guessExt(mimetype: string): string {
  if (mimetype === 'application/pdf') return '.pdf';
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

export const uploadsRouter = Router();

// Multi-page menu PDFs are common (a cover page, then several pages of
// items) -- convert up to this many pages so nothing past a short cover
// gets silently dropped. Capped to keep a single upload's LLM request
// (and pdftoppm's own work) bounded.
const MAX_PDF_PAGES = 40;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// ---------------------------------------------------------------------
// Chunked upload: a single multipart POST of a large file is what was
// timing out at Cloudflare's edge (~60-100s) on a slow connection --
// that timeout is on the request body finishing upload, so it happens
// regardless of how fast this server is. Splitting the file into small
// chunks client-side (each well under any such timeout) and uploading
// them one at a time, then assembling server-side, sidesteps that
// entirely: no single request is ever large or slow enough to hit it.
// ---------------------------------------------------------------------

interface UploadSession {
  filename: string; // final on-disk name (random + real extension)
  mimetype: string;
  totalChunks: number;
  receivedChunks: Set<number>;
}

const sessionsById = new Map<string, UploadSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function guardedSession(id: string, res: import('express').Response): UploadSession | null {
  const session = sessionsById.get(id);
  if (!session) {
    res.status(404).json({ error: 'Upload session not found or expired' });
    return null;
  }
  return session;
}

/** Starts a chunked upload: pass the file's name, mimetype, size and how many chunks it'll be split into. */
uploadsRouter.post('/init', (req, res) => {
  const { filename, mimetype, size, totalChunks } = req.body as {
    filename?: string;
    mimetype?: string;
    size?: number;
    totalChunks?: number;
  };

  if (!mimetype || !totalChunks || !size) {
    return res.status(400).json({ error: 'mimetype, size and totalChunks are required' });
  }
  if (!mimetype.startsWith('image/') && mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only images or PDFs are accepted' });
  }
  if (size > MAX_FILE_SIZE) {
    return res.status(400).json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` });
  }

  const id = randomUUID();
  const ext = path.extname(filename || '') || guessExt(mimetype);
  fs.mkdirSync(path.join(CHUNKS_DIR, id), { recursive: true });
  sessionsById.set(id, { filename: `${randomUUID()}${ext}`, mimetype, totalChunks, receivedChunks: new Set() });
  setTimeout(() => {
    sessionsById.delete(id);
    fs.rmSync(path.join(CHUNKS_DIR, id), { recursive: true, force: true });
  }, SESSION_TTL_MS);

  res.status(201).json({ sessionId: id });
});

/** Uploads one chunk (raw binary body) of an in-progress session. */
uploadsRouter.post('/:sessionId/chunk/:index', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const session = guardedSession(req.params.sessionId, res);
  if (!session) return;

  const index = parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    return res.status(400).json({ error: 'Invalid chunk index' });
  }

  fs.writeFileSync(path.join(CHUNKS_DIR, req.params.sessionId, `${index}.part`), req.body as Buffer);
  session.receivedChunks.add(index);
  res.status(204).end();
});

/** All chunks in; assemble the file and kick off the same handling a direct upload would get. */
uploadsRouter.post('/:sessionId/complete', async (req, res) => {
  const session = guardedSession(req.params.sessionId, res);
  if (!session) return;

  if (session.receivedChunks.size !== session.totalChunks) {
    return res.status(400).json({ error: `Missing chunks: received ${session.receivedChunks.size} of ${session.totalChunks}` });
  }

  const chunkDir = path.join(CHUNKS_DIR, req.params.sessionId);
  const finalPath = path.join(UPLOADS_DIR, session.filename);

  try {
    await assembleChunks(chunkDir, finalPath, session.totalChunks);
  } catch (err) {
    return res.status(500).json({ error: `Could not assemble upload: ${(err as Error).message}` });
  } finally {
    fs.rmSync(chunkDir, { recursive: true, force: true });
    sessionsById.delete(req.params.sessionId);
  }

  await handleUploadedFile(finalPath, session.mimetype, res);
});

function assembleChunks(chunkDir: string, finalPath: string, totalChunks: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(finalPath);
    out.on('error', reject);
    out.on('finish', resolve);

    (async () => {
      try {
        for (let i = 0; i < totalChunks; i++) {
          const buf = fs.readFileSync(path.join(chunkDir, `${i}.part`));
          if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        }
        out.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

// ---------------------------------------------------------------------
// Conversion: a single image responds immediately. A PDF is rendered
// page-by-page to PNG (via poppler's pdftoppm, up to MAX_PDF_PAGES)
// since vision LLMs expect images, not a PDF, in the image_url field --
// every rendered page is later sent to the parser as a separate image,
// so items aren't missed just because they're not on page 1. Converting
// one page at a time (instead of one pdftoppm call for the whole range)
// is what makes per-page progress possible: this responds immediately
// (202) with a token to poll via GET /:id while conversion continues in
// the background.
// ---------------------------------------------------------------------

interface ConversionProgress {
  totalPages: number;
  pagesConverted: number;
  done: boolean;
  error?: string;
  urls?: string[];
}

const progressById = new Map<string, ConversionProgress>();
const PROGRESS_TTL_MS = 10 * 60 * 1000;

async function handleUploadedFile(filePath: string, mimetype: string, res: import('express').Response) {
  const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;

  if (mimetype !== 'application/pdf') {
    return res.status(201).json({ urls: [`${publicApiUrl}/uploads/${path.basename(filePath)}`] });
  }

  let totalPages: number;
  try {
    const { stdout } = await execFileAsync('pdfinfo', [filePath]);
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    totalPages = Math.min(match ? parseInt(match[1], 10) : MAX_PDF_PAGES, MAX_PDF_PAGES);
  } catch (err) {
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: `Could not read the PDF: ${(err as Error).message}` });
  }

  const id = randomUUID();
  progressById.set(id, { totalPages, pagesConverted: 0, done: false });
  res.status(202).json({ conversionId: id, totalPages });

  convertPdfPages(id, filePath, totalPages, publicApiUrl).catch((err) => {
    progressById.set(id, { totalPages, pagesConverted: 0, done: true, error: (err as Error).message });
    scheduleProgressCleanup(id);
  });
}

/** Poll this while a PDF conversion is running. */
uploadsRouter.get('/:id', (req, res) => {
  const progress = progressById.get(req.params.id);
  if (!progress) return res.status(404).json({ error: 'Not found or expired' });
  res.json(progress);
});

async function convertPdfPages(id: string, pdfPath: string, totalPages: number, publicApiUrl: string) {
  const urls: string[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const outputBase = path.join(UPLOADS_DIR, randomUUID());
    await execFileAsync('pdftoppm', ['-png', '-f', String(page), '-l', String(page), '-r', '200', pdfPath, outputBase]);

    // pdftoppm appends a page-number suffix whose zero-padding isn't
    // fixed (depends on the poppler version) -- read back whatever it
    // actually produced rather than assuming the suffix format.
    const outputName = path.basename(outputBase);
    const produced = fs.readdirSync(UPLOADS_DIR).find((f) => f.startsWith(outputName) && f.endsWith('.png'));
    if (produced) urls.push(`${publicApiUrl}/uploads/${produced}`);

    progressById.set(id, { totalPages, pagesConverted: page, done: false });
  }

  fs.unlinkSync(pdfPath);
  progressById.set(id, { totalPages, pagesConverted: totalPages, done: true, urls });
  scheduleProgressCleanup(id);
}

function scheduleProgressCleanup(id: string) {
  setTimeout(() => progressById.delete(id), PROGRESS_TTL_MS);
}
