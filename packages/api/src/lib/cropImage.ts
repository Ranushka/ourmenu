import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { UPLOADS_DIR } from '../routes/uploads';

function publicApiUrl() {
  return process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;
}

function localPathForUploadUrl(url: string): string | null {
  const prefix = `${publicApiUrl()}/uploads/`;
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  // Guard against a filename smuggling a path (e.g. "../../etc/passwd") --
  // every real upload is a bare randomUUID()-based name with no slashes.
  if (!filename || filename.includes('/') || filename.includes('..')) return null;
  return path.join(UPLOADS_DIR, filename);
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops a dish photo out of a source page image, given a bounding box as
 * fractions (0-1) of that image's width/height -- what the parser's model
 * returns, since it has no idea of the image's actual pixel dimensions.
 * Returns the cropped photo's public URL, or null if the source can't be
 * found or the box doesn't resolve to a sane region (best-effort: a bad
 * box just means no photo for that item, not a failed parse).
 */
export async function cropDishPhoto(pageImageUrl: string, box: NormalizedBox): Promise<string | null> {
  const srcPath = localPathForUploadUrl(pageImageUrl);
  if (!srcPath || !fs.existsSync(srcPath)) return null;

  try {
    const image = sharp(srcPath);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;

    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    const left = Math.round(clamp01(box.x) * meta.width);
    const top = Math.round(clamp01(box.y) * meta.height);
    const width = Math.min(Math.round(clamp01(box.width) * meta.width), meta.width - left);
    const height = Math.min(Math.round(clamp01(box.height) * meta.height), meta.height - top);
    if (width < 10 || height < 10) return null; // too small to be a real photo, not worth keeping

    const filename = `${randomUUID()}.jpg`;
    await image.extract({ left, top, width, height }).jpeg({ quality: 85 }).toFile(path.join(UPLOADS_DIR, filename));

    return `${publicApiUrl()}/uploads/${filename}`;
  } catch {
    return null; // best-effort -- a bad crop just means no photo, not a failed item
  }
}
