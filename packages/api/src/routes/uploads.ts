import { Router } from 'express';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const uploadsRouter = Router();

/**
 * Accepts one already-rendered page image (raw JPEG bytes) and returns
 * its public URL. Menu photos and PDF pages are both rendered/compressed
 * client-side (see packages/web/src/lib/renderUpload.ts) before ever
 * reaching here -- a raw multi-page PDF or an 8-12MB phone photo trying
 * to survive one slow upload was what actually timed out at Cloudflare's
 * edge on a slow connection, not anything server-side could fix, since
 * that timeout hits while the request body is still arriving. Each
 * client-rendered page is small (JPEG, capped resolution) and uploaded
 * as its own request, so no single upload here is ever large or slow
 * enough to be at real risk of that.
 */
uploadsRouter.post('/', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const body = req.body as Buffer;
  if (!body?.length) return res.status(400).json({ error: 'No file uploaded' });

  const filename = `${randomUUID()}.jpg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), body);

  const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3333}`;
  res.status(201).json({ url: `${publicApiUrl}/uploads/${filename}` });
});
