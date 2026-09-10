// Remembered across visits to ANY restaurant's menu link — this is what
// lets someone stop repeating their address/preferences every order.
export interface DinerProfile {
  name?: string;
  phone?: string;
  address?: string;
  preferences?: string;
}

const KEY = 'ourmenu.dinerProfile';

export function loadDinerProfile(): DinerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDinerProfile(profile: DinerProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // ignore (private browsing, storage disabled, etc.)
  }
}
