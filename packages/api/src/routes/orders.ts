import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { buildOrderMessage, buildWhatsappLink } from '../lib/whatsapp';

export const ordersRouter = Router();

interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  note?: string;
}

/**
 * "Order Now" — builds the WhatsApp message + deep link for the diner's
 * selection, saves an Order record, and upserts their DinerProfile so
 * address/preferences are remembered next time (paired with localStorage
 * on the client for instant prefill).
 */
ordersRouter.post('/', async (req, res) => {
  const { menuSlug, items, address, preferences, phone, name } = req.body as {
    menuSlug?: string;
    items?: OrderItemInput[];
    address?: string;
    preferences?: string;
    phone?: string;
    name?: string;
  };

  if (!menuSlug || !items?.length) {
    return res.status(400).json({ error: 'menuSlug and items are required' });
  }

  const menu = await prisma.menu.findUnique({ where: { slug: menuSlug } });
  if (!menu) return res.status(404).json({ error: 'Menu not found' });
  if (!menu.restaurantWhatsapp) {
    return res.status(422).json({ error: 'This menu has no WhatsApp number configured yet' });
  }

  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, menuId: menu.id },
  });
  const menuItemById = new Map(menuItems.map((mi) => [mi.id, mi]));

  const missing = items.find((i) => !menuItemById.has(i.menuItemId));
  if (missing) return res.status(400).json({ error: `Unknown menu item: ${missing.menuItemId}` });

  let dinerProfile = null;
  if (phone) {
    dinerProfile = await prisma.dinerProfile.upsert({
      where: { phone },
      update: { address: address ?? undefined, preferences: preferences ?? undefined, name: name ?? undefined },
      create: { phone, address, preferences, name },
    });
  }

  const whatsappText = buildOrderMessage({
    restaurantName: menu.restaurantName,
    items: items.map((i) => ({
      name: menuItemById.get(i.menuItemId)!.name,
      quantity: i.quantity,
      note: i.note,
    })),
    address,
    preferences,
  });

  const order = await prisma.order.create({
    data: {
      menuId: menu.id,
      dinerProfileId: dinerProfile?.id,
      address,
      preferences,
      whatsappText,
      items: {
        create: items.map((i) => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          note: i.note,
          priceAtOrder: menuItemById.get(i.menuItemId)!.price,
        })),
      },
    },
  });

  res.status(201).json({
    orderId: order.id,
    whatsappText,
    whatsappLink: buildWhatsappLink(menu.restaurantWhatsapp, whatsappText),
  });
});
