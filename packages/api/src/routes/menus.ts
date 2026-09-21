import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { chunkPages, parseMenuImageChunk, ParsedMenuItem } from '../lib/openrouter';
import { cropDishPhoto } from '../lib/cropImage';

export const menusRouter = Router();

// The diner link is keyed off the WhatsApp number the uploader submitted,
// not the restaurant name off the menu image -- a number is stable across
// re-uploads/corrections and is what the uploader actually typed in,
// rather than whatever the parser happened to read off a logo.
// NOTE: this makes the slug guessable from the number alone, which is a
// known, deliberately deferred tradeoff for now (easy to add a random
// suffix back later without changing anything else).
function slugify(whatsapp: string): string {
  const digits = whatsapp.replace(/[^0-9]/g, '');
  return digits || `menu-${Math.random().toString(36).slice(2, 7)}`;
}

// A model occasionally returns an item with no usable price (e.g. a
// "market price" line, or a mis-read row) -- price is a required column,
// so an item like that would otherwise crash the whole createMany and
// lose every other item in the chunk. Drop just that item instead of
// failing the whole batch over one bad row.
function validItems(items: ParsedMenuItem[]): ParsedMenuItem[] {
  return items.filter((item) => item.name && typeof item.price === 'number' && Number.isFinite(item.price));
}

/**
 * Resolves each item's model-reported photo bounding box into an actual
 * cropped image, given the page URLs of the chunk it was parsed from
 * ("photo.page" is an index into that same array -- the model only ever
 * saw those images, so that's the only page numbering it can use). Runs
 * concurrently since these are local crops, not network calls. Best-
 * effort: an item whose box doesn't resolve to anything just keeps no
 * photo rather than failing.
 */
async function resolveDishPhotos(items: ParsedMenuItem[], pageUrls: string[]): Promise<ParsedMenuItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const box = item.photo;
      const pageUrl = box && Number.isInteger(box.page) ? pageUrls[box.page] : undefined;
      if (!box || !pageUrl) return item;
      const photoUrl = await cropDishPhoto(pageUrl, box);
      return photoUrl ? { ...item, photoUrl } : item;
    })
  );
}

/** Appends a parsed chunk's items (and any new categories they need) to an existing menu. Returns how many items were saved. */
async function appendItems(menuId: string, rawItems: (ParsedMenuItem & { photoUrl?: string })[]): Promise<number> {
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
      photoUrl: item.photoUrl,
      position: existingItemCount + i,
    })),
  });

  return items.length;
}

/** Parses remaining page-chunks one at a time and appends their items, marking the menu ready when done. Not awaited by the request handler -- runs after the response has already gone out. */
async function processRemainingChunks(menuId: string, chunks: string[][], pagesReadSoFar: number) {
  // One chunk exhausting its retries (a page or two of a 30-page menu
  // hitting a stubborn timeout) shouldn't cost every chunk after it --
  // keep going and surface which ones failed rather than abandoning the
  // rest of a menu that's otherwise parsing fine.
  const chunkErrors: string[] = [];
  let pagesRead = pagesReadSoFar;
  for (const pages of chunks) {
    try {
      const parsed = await parseMenuImageChunk(pages);
      await appendItems(menuId, await resolveDishPhotos(parsed.items, pages));
    } catch (err) {
      chunkErrors.push((err as Error).message);
    }
    pagesRead += pages.length;
    // Updated after every chunk (not just at the end) so a client
    // polling for progress sees "page X of Y" advance as each chunk
    // actually finishes, not just a final jump to done.
    await prisma.menu.update({ where: { id: menuId }, data: { pagesRead } }).catch(() => {});
  }

  await prisma.menu
    .update({
      where: { id: menuId },
      data: {
        status: 'ready',
        parseError:
          chunkErrors.length > 0
            ? `${chunkErrors.length}/${chunks.length} page-chunk(s) failed to parse: ${chunkErrors[0]}`
            : null,
      },
    })
    .catch((updateErr) => console.error(`Menu ${menuId}: failed to finalize status`, updateErr));
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
    // Slug collides if this number already has a menu (e.g. a re-upload) --
    // fall back to a suffixed slug rather than failing the whole upload.
    // Not a fix for the number being guessable in the first place, just
    // for two menus wanting the same one.
    const baseData = {
      restaurantName,
      restaurantWhatsapp,
      sourceImageUrl: imageUrls[0],
      status: (restChunks.length > 0 ? 'processing' : 'ready') as 'processing' | 'ready',
      totalPages: imageUrls.length,
      pagesRead: firstChunk.length,
    };

    let menu;
    try {
      menu = await prisma.menu.create({ data: { slug: slugify(restaurantWhatsapp), ...baseData } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      menu = await prisma.menu.create({
        data: { slug: `${slugify(restaurantWhatsapp)}-${Math.random().toString(36).slice(2, 7)}`, ...baseData },
      });
    }

    const itemCount = await appendItems(menu.id, await resolveDishPhotos(parsed.items, firstChunk));

    res.status(201).json({
      slug: menu.slug,
      manageToken: menu.manageToken,
      restaurantName: menu.restaurantName,
      itemCount,
      status: menu.status,
      totalPages: menu.totalPages,
      pagesRead: menu.pagesRead,
    });

    if (restChunks.length > 0) {
      processRemainingChunks(menu.id, restChunks, firstChunk.length);
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
