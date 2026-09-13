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

/**
 * Accepts a menu photo OR a PDF picked from the device's own files.
 * A PDF's first page is rendered to PNG server-side (via poppler's
 * pdftoppm) since vision LLMs expect an image, not a PDF, in the
 * image_url field.
 */
uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let filename = req.file.filename;

  if (req.file.mimetype === 'application/pdf') {
    const pdfPath = path.join(UPLOADS_DIR, filename);
    const outputBase = path.join(UPLOADS_DIR, randomUUID());
    try {
      // First page only, at a resolution good enough for menu text.
      await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', '1', '-r', '200', pdfPath, outputBase]);
      fs.unlinkSync(pdfPath);
      filename = `${path.basename(outputBase)}-1.png`;
    } catch (err) {
      return res.status(500).json({ error: `Could not read the PDF: ${(err as Error).message}` });
    }
  }

  const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;
  res.status(201).json({ url: `${publicApiUrl}/uploads/${filename}` });
});
