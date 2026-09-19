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
  phase: 'uploading' | 'converting';
  chunksUploaded: number;
  totalChunks: number;
  pagesConverted: number;
  totalPages: number;
}

// 1MB per chunk -- small enough that a single chunk's upload can't
// realistically hit a proxy timeout even on a slow connection, which is
// exactly the problem this sidesteps: one multipart POST of a large file
// was timing out at Cloudflare's edge on the request body itself, before
// this app's own server ever got a chance to respond.
const CHUNK_SIZE = 1024 * 1024;

/**
 * Uploads a picked file (photo or PDF) in small chunks and returns its
 * public page URL(s) -- a PDF renders to one URL per page. Calls
 * `onProgress` as chunks land and, for a PDF, as each page converts
 * server-side afterwards, rather than leaving the caller waiting on one
 * long request with no feedback (and, for a large file on a slow
 * connection, at real risk of that single request timing out).
 */
async function uploadFile(file: File, onProgress?: (p: UploadProgress) => void): Promise<{ urls: string[] }> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  const { sessionId } = await request<{ sessionId: string }>('/api/uploads/init', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, mimetype: file.type, size: file.size, totalChunks }),
  });

  for (let i = 0; i < totalChunks; i++) {
    const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const res = await fetch(`${API_URL}/api/uploads/${sessionId}/chunk/${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Chunk upload failed: ${res.status}`, res.status);
    }
    onProgress?.({ phase: 'uploading', chunksUploaded: i + 1, totalChunks, pagesConverted: 0, totalPages: 0 });
  }

  const completeRes = await fetch(`${API_URL}/api/uploads/${sessionId}/complete`, { method: 'POST' });
  const completeBody = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) throw new ApiError(completeBody.error || `Upload failed: ${completeRes.status}`, completeRes.status);

  if (completeRes.status === 201) return completeBody as { urls: string[] };

  // 202: a PDF, converting page-by-page in the background.
  const { conversionId, totalPages } = completeBody as { conversionId: string; totalPages: number };
  onProgress?.({ phase: 'converting', chunksUploaded: totalChunks, totalChunks, pagesConverted: 0, totalPages });

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const progress = await request<{ totalPages: number; pagesConverted: number; done: boolean; error?: string; urls?: string[] }>(
      `/api/uploads/${conversionId}`
    );
    onProgress?.({
      phase: 'converting',
      chunksUploaded: totalChunks,
      totalChunks,
      pagesConverted: progress.pagesConverted,
      totalPages: progress.totalPages,
    });
    if (progress.done) {
      if (progress.error) throw new ApiError(progress.error, 500);
      return { urls: progress.urls ?? [] };
    }
  }
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
