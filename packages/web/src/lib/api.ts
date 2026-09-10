const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface MenuItem {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  isVeg: boolean | null;
  isAvailable: boolean;
  photoUrl: string | null;
}

export interface MenuCategory {
  id: string;
  name: string;
  position: number;
}

export interface Menu {
  id: string;
  slug: string;
  restaurantName: string;
  restaurantWhatsapp: string | null;
  categories: MenuCategory[];
  items: MenuItem[];
}

export const api = {
  createMenu: (data: { restaurantName: string; imageUrl: string; createdByRole?: 'DINER' | 'RESTAURANT' }) =>
    request<{ slug: string; manageToken: string; itemCount: number }>('/api/menus', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMenu: (slug: string) => request<Menu>(`/api/menus/${slug}`),

  getManageMenu: (manageToken: string) => request<Menu>(`/api/menus/manage/${manageToken}`),

  claimMenu: (manageToken: string, whatsapp: string) =>
    request(`/api/menus/manage/${manageToken}/claim`, {
      method: 'POST',
      body: JSON.stringify({ whatsapp }),
    }),

  updateItem: (
    manageToken: string,
    itemId: string,
    data: Partial<Pick<MenuItem, 'isAvailable' | 'photoUrl' | 'name' | 'description'>> & { price?: number }
  ) =>
    request(`/api/menus/manage/${manageToken}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  placeOrder: (data: {
    menuSlug: string;
    items: { menuItemId: string; quantity: number; note?: string }[];
    address?: string;
    preferences?: string;
    phone?: string;
    name?: string;
  }) =>
    request<{ orderId: string; whatsappText: string; whatsappLink: string }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
