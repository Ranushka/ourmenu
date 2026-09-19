/**
 * Menu parsing: sends a photo/PDF of a menu to a vision-capable LLM via
 * OpenRouter and asks for structured items back, plus a best-effort guess
 * at the restaurant's name from the image itself (most menus print it) —
 * the uploader is never asked to type it. Model is swappable via env so we
 * can start on a free-tier model and upgrade later.
 */

// Points at OpenRouter directly by default; override with OPENROUTER_URL to
// route through a proxy (e.g. a self-hosted 9router instance) instead.
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';

// Free-tier-friendly default; override with OPENROUTER_MODEL env var.
// meta-llama/llama-3.2-11b-vision-instruct:free was removed from OpenRouter's
// model list (confirmed gone 2026-09-18) -- switched to a maintained free
// vision-language model with strong document/OCR performance.
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3.8-27b:free';

export interface ParsedMenuItem {
  name: string;
  description?: string;
  price: number;
  category?: string;
  isVeg?: boolean | null;
}

export interface ParsedMenu {
  restaurantName: string | null;
  items: ParsedMenuItem[];
}

const SYSTEM_PROMPT = `You read photos of restaurant menus and extract structured data as strict JSON.
Return ONLY a JSON object (no markdown fences, no commentary) shaped like:
{
  "restaurantName": string | null,
  "items": [
    {"name": string, "description": string | null, "price": number, "category": string | null, "isVeg": boolean | null}
  ]
}
- "restaurantName" is the restaurant/cafe's name if it appears anywhere on the menu (header, logo text, footer), else null. Do not guess from cuisine type.
- "price" is a plain number (no currency symbol).
- "isVeg" is true for clearly vegetarian items, false for clearly non-veg (meat/fish/egg), null if unclear.
- "category" is the section heading the item appeared under (e.g. "Starters"), null if none.
- Skip section headings, prices-only lines, and non-item text from "items".
- A menu is often several pages (e.g. a cover page, then item pages) -- items can appear on any page given, not just the first; combine them all into one "items" list.`;

// A "Fallback" combo (e.g. on a self-hosted 9router) picks one model per
// request rather than retrying other models within a single call -- if
// that model is rate-limited, the request just fails. Retrying the whole
// request gives it another chance to land on a model that isn't.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

// Free-tier vision models get unreliable well before a menu's real page
// count (confirmed: 32 images in one call comes back empty or fails
// outright, while 5 reliably extracts 40+ items) -- so a multi-page menu
// is parsed in chunks of this many pages, one LLM call per chunk. Chunks
// are parsed one at a time by the caller (see routes/menus.ts) rather
// than all awaited here, since a menu with several chunks can take
// minutes total -- longer than one HTTP request should reasonably hold
// open -- so the first chunk responds to the client and the rest are
// processed in the background.
export const PAGES_PER_CHUNK = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkPages<T>(items: T[], size: number = PAGES_PER_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function parseMenuImageChunk(imageUrls: string[]): Promise<ParsedMenu> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        // Explicit: a proxy in front of OpenRouter (e.g. 9router) can default
        // to a streaming-shaped response when this is omitted, which breaks
        // res.json() below.
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  imageUrls.length > 1
                    ? `Extract the restaurant name and menu items from these ${imageUrls.length} menu pages as JSON.`
                    : 'Extract the restaurant name and menu items from this photo as JSON.',
              },
              ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
            ],
          },
        ],
      }),
    });

    if (res.ok) return await parseResponse(res);

    const body = await res.text();
    lastError = new Error(`OpenRouter request failed (${res.status}): ${body}`);
    // 429/503 = rate-limited/overloaded upstream; 502/504/524 = the proxy
    // (Cloudflare, in front of a self-hosted 9router) gave up waiting on a
    // slow free-tier model -- all transient, worth another attempt.
    const retryable = [429, 502, 503, 504, 524].includes(res.status);
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(RETRY_DELAY_MS);
  }
  throw lastError;
}

async function parseResponse(res: Response): Promise<ParsedMenu> {
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '{}';
  const jsonText = content.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('Model did not return { restaurantName, items }');
    return { restaurantName: parsed.restaurantName ?? null, items: parsed.items };
  } catch (err) {
    throw new Error(`Could not parse model output as JSON: ${(err as Error).message}\nRaw: ${content}`);
  }
}
