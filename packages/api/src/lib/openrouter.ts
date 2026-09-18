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
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free';

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
- Skip section headings, prices-only lines, and non-item text from "items".`;

export async function parseMenuImage(imageUrl: string): Promise<ParsedMenu> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the restaurant name and menu items from this photo as JSON.' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${body}`);
  }

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
