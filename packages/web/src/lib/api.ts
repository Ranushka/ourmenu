import { renderPdfPages, compressImage } from './renderUpload';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status);
  }
  return res.json();
}

export interface UploadProgress {
  pagesUploaded: number;
  totalPages: number;
}

async function uploadBlob(blob: Blob): Promise<string> {
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Upload failed: ${res.status}`, res.status);
  return (body as { url: string }).url;
}

/**
 * Uploads a picked file (photo or PDF) and returns its public page
 * URL(s) -- a PDF renders to one URL per page. Both a PDF's pages and a
 * plain photo are rendered/compressed to JPEG client-side first (see
 * lib/renderUpload.ts) before ever reaching the network, and each page
 * uploads as its own small, independent request -- deliberately, since a
 * raw multi-page PDF or an unresized phone photo trying to survive one
 * slow upload is what actually risks timing out on a slow connection,
 * not anything server-side processing time could fix. Calls `onProgress`
 * as each page finishes uploading.
 */
async function uploadFile(file: File, onProgress?: (p: UploadProgress) => void): Promise<{ urls: string[] }> {
  const blobs =
    file.type === 'application/pdf'
      ? await renderPdfPages(file, (rendered, total) => onProgress?.({ pagesUploaded: 0, totalPages: total }))
      : [await compressImage(file)];

  const urls: string[] = [];
  for (const blob of blobs) {
    urls.push(await uploadBlob(blob));
    onProgress?.({ pagesUploaded: urls.length, totalPages: blobs.length });
  }
  return { urls };
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

export type MenuStatus = 'processing' | 'ready' | 'failed';

export interface Menu {
  id: string;
  slug: string;
  restaurantName: string;
  restaurantWhatsapp: string;
  status: MenuStatus;
  parseError?: string | null;
  totalPages?: number | null;
  pagesRead?: number | null;
  sourceImageUrls: string[];
  categories: MenuCategory[];
  items: MenuItem[];
}

export const api = {
  uploadFile,

  createMenu: (data: { imageUrls: string[]; restaurantWhatsapp: string }) =>
    request<{
      slug: string;
      manageToken: string;
      restaurantName: string;
      itemCount: number;
      status: MenuStatus;
      totalPages: number | null;
      pagesRead: number | null;
    }>('/api/menus', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMenu: (slug: string) => request<Menu>(`/api/menus/${slug}`),

  getManageMenu: (manageToken: string) => request<Menu>(`/api/menus/manage/${manageToken}`),

  updateMenu: (manageToken: string, data: Partial<Pick<Menu, 'restaurantName' | 'restaurantWhatsapp'>>) =>
    request<Menu>(`/api/menus/manage/${manageToken}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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
