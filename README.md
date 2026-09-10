# ourmenu

A menu is a search problem, not an ordering problem — restaurants already take
orders fine over WhatsApp. **ourmenu** turns a photo of any menu into a
searchable, filterable web page, and hands the diner's selection back to the
*same* WhatsApp chat as a clean, structured message (items, per-item
preferences, address) instead of a rambling voice note or a repeated
back-and-forth.

Anyone can digitize a menu — a diner tired of an unreadable PDF, or the
restaurant itself. No login required for ordering: the diner's address and
preferences are remembered locally (and by phone number server-side) so they
never have to repeat themselves on the next order, at this restaurant or any
other on the platform.

## How it works

1. **Upload** — a photo of a menu is sent to an LLM (via OpenRouter) that
   extracts items: name, price, category, veg/non-veg.
2. **Browse** — the diner gets a shareable link: searchable, list/grid view,
   veg filter.
3. **Order** — they pick items, set an address + per-item preferences once,
   hit "Order now" — it opens WhatsApp with everything prefilled, sent to the
   restaurant's number.
4. **Manage** (optional) — a restaurant can claim its menu via a private
   manage link: mark items sold out, edit them, add real photos
   (illustration purposes only — not guaranteed to match what arrives).

## Structure (Nx monorepo)

- `packages/web` — diner + restaurant-manage UI (Vite + React)
- `packages/api` — Express API (menu parsing, orders, manage endpoints)
- `docker-compose.yml` — Postgres + api + web, deployed via Dokploy

## Local development

```bash
npm install
docker compose up -d postgres        # local Postgres
npx prisma migrate dev --schema packages/api/prisma/schema.prisma
npx nx serve @org/api                # http://localhost:3333
npx nx serve @org/web                # http://localhost:4200
```

Set `OPENROUTER_API_KEY` in `packages/api/.env` to enable menu parsing.

## Deployment

Deployed on the home Dokploy instance as a Compose app — pushing to `main`
auto-deploys via the Git webhook. Env vars (`OPENROUTER_API_KEY`,
`PUBLIC_API_URL`, etc.) are set in Dokploy, not committed.
