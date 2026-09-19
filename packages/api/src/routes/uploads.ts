import { Router } from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || guessExt(file.mimetype);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images or PDFs are accepted'), ok);
  },
});

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

interface ConversionProgress {
  totalPages: number;
  pagesConverted: number;
  done: boolean;
  error?: string;
  urls?: string[];
}

// In-memory only: a conversion is a few minutes of one server's own work,
// not something that needs to survive a restart or be visible cross-
// instance. Cleaned up a while after finishing so a client has time to
// pick up the final result even if its last poll landed right at "done".
const progressById = new Map<string, ConversionProgress>();
const PROGRESS_TTL_MS = 10 * 60 * 1000;

/**
 * Accepts a menu photo OR a PDF picked from the device's own files. A
 * single image converts and responds immediately (201). A PDF is
 * rendered page-by-page to PNG server-side (via poppler's pdftoppm, up
 * to MAX_PDF_PAGES) since vision LLMs expect images, not a PDF, in the
 * image_url field -- every rendered page is later sent to the parser as
 * a separate image, so items aren't missed just because they're not on
 * page 1. Converting one page at a time (instead of one pdftoppm call
 * for the whole range) is what makes per-page progress possible: this
 * responds immediately (202) with a token to poll via GET /:id while
 * conversion continues in the background.
 */
uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;

  if (req.file.mimetype !== 'application/pdf') {
    return res.status(201).json({ urls: [`${publicApiUrl}/uploads/${req.file.filename}`] });
  }

  const pdfPath = path.join(UPLOADS_DIR, req.file.filename);

  let totalPages: number;
  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    totalPages = Math.min(match ? parseInt(match[1], 10) : MAX_PDF_PAGES, MAX_PDF_PAGES);
  } catch (err) {
    fs.unlinkSync(pdfPath);
    return res.status(500).json({ error: `Could not read the PDF: ${(err as Error).message}` });
  }

  const id = randomUUID();
  progressById.set(id, { totalPages, pagesConverted: 0, done: false });
  res.status(202).json({ conversionId: id, totalPages });

  convertPdfPages(id, pdfPath, totalPages, publicApiUrl).catch((err) => {
    progressById.set(id, { totalPages, pagesConverted: 0, done: true, error: (err as Error).message });
    scheduleCleanup(id);
  });
});

/** Poll this while a PDF conversion (POST above) is running. */
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
  scheduleCleanup(id);
}

function scheduleCleanup(id: string) {
  setTimeout(() => progressById.delete(id), PROGRESS_TTL_MS);
}
