import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { parseMenuImage } from '../lib/openrouter';

export const menusRouter = Router();

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'menu'}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a menu from an already-uploaded image URL. Anyone can call this —
 * a diner digitizing a restaurant's paper menu, or the restaurant itself.
 * The restaurant name is read off the menu photo by the parser, not typed
 * in — but the WhatsApp number orders should go to can't be derived from
 * a URL or the image, so it's the one thing asked for up front.
 */
menusRouter.post('/', async (req, res) => {
  const { imageUrl, restaurantWhatsapp } = req.body as {
    imageUrl?: string;
    restaurantWhatsapp?: string;
  };

  if (!imageUrl || !restaurantWhatsapp) {
    return res.status(400).json({ error: 'imageUrl and restaurantWhatsapp are required' });
  }

  let parsed;
  try {
    parsed = await parseMenuImage(imageUrl);
  } catch (err) {
    return res.status(502).json({ error: `Menu parsing failed: ${(err as Error).message}` });
  }

  const restaurantName = parsed.restaurantName?.trim() || 'Menu';
  const categoryNames = [...new Set(parsed.items.map((i) => i.category).filter(Boolean))] as string[];

  const menu = await prisma.menu.create({
    data: {
      slug: slugify(restaurantName),
      restaurantName,
      restaurantWhatsapp,
      sourceImageUrl: imageUrl,
      categories: {
        create: categoryNames.map((name, position) => ({ name, position })),
      },
    },
    include: { categories: true },
  });

  const categoryIdByName = new Map(menu.categories.map((c) => [c.name, c.id]));

  await prisma.menuItem.createMany({
    data: parsed.items.map((item, position) => ({
      menuId: menu.id,
      categoryId: item.category ? categoryIdByName.get(item.category) : undefined,
      name: item.name,
      description: item.description || undefined,
      price: item.price,
      isVeg: item.isVeg ?? null,
      position,
    })),
  });

  res.status(201).json({
    slug: menu.slug,
    manageToken: menu.manageToken,
    restaurantName: menu.restaurantName,
    itemCount: parsed.items.length,
  });
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
  const { manageToken, ...publicMenu } = menu;
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
