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

/**
 * Accepts a menu photo OR a PDF picked from the device's own files. A
 * PDF is rendered page-by-page to PNG server-side (via poppler's
 * pdftoppm, up to MAX_PDF_PAGES) since vision LLMs expect images, not a
 * PDF, in the image_url field -- every rendered page is sent to the
 * parser as a separate image in one request, so items aren't missed
 * just because they're not on page 1.
 */
uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;
  let filenames = [req.file.filename];

  if (req.file.mimetype === 'application/pdf') {
    const pdfPath = path.join(UPLOADS_DIR, req.file.filename);
    const outputBase = path.join(UPLOADS_DIR, randomUUID());
    try {
      await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(MAX_PDF_PAGES), '-r', '200', pdfPath, outputBase]);
      fs.unlinkSync(pdfPath);
      // pdftoppm appends a page-number suffix whose zero-padding isn't
      // fixed (depends on the poppler version and page count) -- read
      // back whatever it actually produced rather than assuming the
      // suffix format, and sort by the numeric page number since that
      // padding also affects lexical sort order.
      const outputName = path.basename(outputBase);
      const produced = fs
        .readdirSync(UPLOADS_DIR)
        .filter((f) => f.startsWith(outputName) && f.endsWith('.png'))
        .map((f) => ({ f, page: parseInt(f.slice(outputName.length + 1, -'.png'.length), 10) }))
        .sort((a, b) => a.page - b.page)
        .map(({ f }) => f);
      if (produced.length === 0) throw new Error('pdftoppm did not produce an output file');
      filenames = produced;
    } catch (err) {
      return res.status(500).json({ error: `Could not read the PDF: ${(err as Error).message}` });
    }
  }

  res.status(201).json({ urls: filenames.map((f) => `${publicApiUrl}/uploads/${f}`) });
});
