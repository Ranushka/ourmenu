import * as pdfjsLib from 'pdfjs-dist';
// Vite-specific import: gives the bundled URL of the worker script rather
// than its contents, which is what pdf.js's GlobalWorkerOptions wants.
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Menu PDFs are commonly a cover page then several pages of items --
// render up to this many so nothing past a short cover gets silently
// dropped, matching the server-side parser's own chunking cap.
const MAX_PAGES = 40;
// Long-edge pixel cap and JPEG quality for every image this app uploads,
// whether it's a PDF page or a picked photo. A vision model reads text
// off these, not fine art, so this stays comfortably legible while
// keeping each upload small: a raw multi-megabyte PDF or an 8-12MB phone
// photo trying to survive one slow upload was the actual root cause of
// upload timeouts on a slow connection, not anything about page count.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), 'image/jpeg', JPEG_QUALITY);
  });
}

/**
 * Renders each page of a PDF to a compressed JPEG, entirely in the
 * browser -- the server never sees the original PDF, only small
 * already-rendered page images, one small upload each instead of one
 * large slow one.
 */
export async function renderPdfPages(file: File, onPage?: (rendered: number, total: number) => void): Promise<Blob[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = Math.min(pdf.numPages, MAX_PAGES);

  const blobs: Blob[] = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = MAX_DIMENSION / Math.max(unscaled.width, unscaled.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('Canvas 2D context unavailable');

    await page.render({ canvasContext, viewport, canvas }).promise;
    blobs.push(await canvasToJpeg(canvas));
    onPage?.(pageNum, totalPages);
  }

  return blobs;
}

/** Resizes/recompresses a picked photo client-side for the same reason -- a large phone photo shouldn't need to survive a slow raw upload either. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToJpeg(canvas);
}
