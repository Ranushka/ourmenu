import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { chunkPages, parseMenuImageChunk, ParsedMenuItem } from '../lib/openrouter';

export const menusRouter = Router();

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'menu'}-${Math.random().toString(36).slice(2, 7)}`;
}

// A model occasionally returns an item with no usable price (e.g. a
// "market price" line, or a mis-read row) -- price is a required column,
// so an item like that would otherwise crash the whole createMany and
// lose every other item in the chunk. Drop just that item instead of
// failing the whole batch over one bad row.
function validItems(items: ParsedMenuItem[]): ParsedMenuItem[] {
  return items.filter((item) => item.name && typeof item.price === 'number' && Number.isFinite(item.price));
}

/** Appends a parsed chunk's items (and any new categories they need) to an existing menu. Returns how many items were saved. */
async function appendItems(menuId: string, rawItems: ParsedMenuItem[]): Promise<number> {
  const items = validItems(rawItems);
  if (items.length === 0) return 0;

  const existingCategories = await prisma.menuCategory.findMany({ where: { menuId } });
  const categoryIdByName = new Map(existingCategories.map((c) => [c.name, c.id]));
  const newCategoryNames = [...new Set(items.map((i) => i.category).filter(Boolean))].filter(
    (name) => !categoryIdByName.has(name as string)
  ) as string[];

  if (newCategoryNames.length > 0) {
    const nextPosition = existingCategories.length;
    await prisma.menuCategory.createMany({
      data: newCategoryNames.map((name, i) => ({ menuId, name, position: nextPosition + i })),
    });
    const created = await prisma.menuCategory.findMany({ where: { menuId, name: { in: newCategoryNames } } });
    created.forEach((c) => categoryIdByName.set(c.name, c.id));
  }

  const existingItemCount = await prisma.menuItem.count({ where: { menuId } });
  await prisma.menuItem.createMany({
    data: items.map((item, i) => ({
      menuId,
      categoryId: item.category ? categoryIdByName.get(item.category) : undefined,
      name: item.name,
      description: item.description || undefined,
      price: item.price,
      isVeg: item.isVeg ?? null,
      position: existingItemCount + i,
    })),
  });

  return items.length;
}

/** Parses remaining page-chunks one at a time and appends their items, marking the menu ready/failed when done. Not awaited by the request handler -- runs after the response has already gone out. */
async function processRemainingChunks(menuId: string, chunks: string[][]) {
  try {
    for (const pages of chunks) {
      const parsed = await parseMenuImageChunk(pages);
      await appendItems(menuId, parsed.items);
    }
    await prisma.menu.update({ where: { id: menuId }, data: { status: 'ready' } });
  } catch (err) {
    await prisma.menu
      .update({ where: { id: menuId }, data: { status: 'failed', parseError: (err as Error).message } })
      .catch((updateErr) => console.error(`Menu ${menuId}: failed to record parse failure`, updateErr));
  }
}

/**
 * Create a menu from already-uploaded page image(s). Anyone can call this —
 * a diner digitizing a restaurant's paper menu, or the restaurant itself.
 * The restaurant name is read off the menu photo by the parser, not typed
 * in — but the WhatsApp number orders should go to can't be derived from
 * a URL or the image, so it's the one thing asked for up front.
 *
 * Only the first page-chunk is parsed before responding (fast enough for
 * one request/response cycle, and it's where a menu's name usually is,
 * for a proper slug). A menu with more pages than that keeps parsing in
 * the background — status starts "processing" and flips to "ready" (or
 * "failed") once every chunk's been through.
 */
menusRouter.post('/', async (req, res) => {
  const { imageUrls, restaurantWhatsapp } = req.body as {
    imageUrls?: string[];
    restaurantWhatsapp?: string;
  };

  if (!imageUrls?.length || !restaurantWhatsapp) {
    return res.status(400).json({ error: 'imageUrls and restaurantWhatsapp are required' });
  }

  const [firstChunk, ...restChunks] = chunkPages(imageUrls);

  let parsed;
  try {
    parsed = await parseMenuImageChunk(firstChunk);
  } catch (err) {
    return res.status(502).json({ error: `Menu parsing failed: ${(err as Error).message}` });
  }

  const restaurantName = parsed.restaurantName?.trim() || 'Menu';

  try {
    const menu = await prisma.menu.create({
      data: {
        slug: slugify(restaurantName),
        restaurantName,
        restaurantWhatsapp,
        sourceImageUrl: imageUrls[0],
        status: restChunks.length > 0 ? 'processing' : 'ready',
      },
    });

    const itemCount = await appendItems(menu.id, parsed.items);

    res.status(201).json({
      slug: menu.slug,
      manageToken: menu.manageToken,
      restaurantName: menu.restaurantName,
      itemCount,
      status: menu.status,
    });

    if (restChunks.length > 0) {
      processRemainingChunks(menu.id, restChunks);
    }
  } catch (err) {
    res.status(500).json({ error: `Could not save the menu: ${(err as Error).message}` });
  }
});

/** Public menu view — no auth, this is the link shared over WhatsApp. */
menusRouter.get('/:slug', async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { slug: req.params.slug },
    include: {
      categories: { orderBy: { position: 'asc' } },
      items: { orderBy: { position: 'asc' } },
    },
  });
  if (!menu) return res.status(404).json({ error: 'Menu not found' });
  const { manageToken, parseError, ...publicMenu } = menu;
  res.json(publicMenu);
});

/** Manage view (restaurant side) — requires the secret manageToken. */
menusRouter.get('/manage/:manageToken', async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { manageToken: req.params.manageToken },
    include: { categories: true, items: true },
  });
  if (!menu) return res.status(404).json({ error: 'Not found' });
  res.json(menu);
});

/** Correct the restaurant name or the WhatsApp number orders go to. */
menusRouter.patch('/manage/:manageToken', async (req, res) => {
  const { restaurantName, restaurantWhatsapp } = req.body as {
    restaurantName?: string;
    restaurantWhatsapp?: string;
  };

  const menu = await prisma.menu.update({
    where: { manageToken: req.params.manageToken },
    data: { restaurantName, restaurantWhatsapp },
  });

  res.json(menu);
});

/** Toggle item availability, update photo, edit fields — restaurant side. */
menusRouter.patch('/manage/:manageToken/items/:itemId', async (req, res) => {
  const menu = await prisma.menu.findUnique({ where: { manageToken: req.params.manageToken } });
  if (!menu) return res.status(404).json({ error: 'Not found' });

  const { isAvailable, photoUrl, name, description, price } = req.body as {
    isAvailable?: boolean;
    photoUrl?: string;
    name?: string;
    description?: string;
    price?: number;
  };

  const item = await prisma.menuItem.update({
    where: { id: req.params.itemId },
    data: { isAvailable, photoUrl, name, description, price },
  });

  res.json(item);
});
