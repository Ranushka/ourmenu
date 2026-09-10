export interface WhatsappOrderInput {
  restaurantName: string;
  items: { name: string; quantity: number; note?: string }[];
  address?: string;
  preferences?: string;
}

/** Builds the plain-text order message that gets handed off to WhatsApp. */
export function buildOrderMessage(input: WhatsappOrderInput): string {
  const lines: string[] = [];
  lines.push(`Order from ${input.restaurantName} (via OurMenu):`);
  lines.push('');
  for (const item of input.items) {
    const note = item.note ? ` (${item.note})` : '';
    lines.push(`- ${item.quantity}x ${item.name}${note}`);
  }
  if (input.address) {
    lines.push('');
    lines.push(`Address: ${input.address}`);
  }
  if (input.preferences) {
    lines.push(`Preferences: ${input.preferences}`);
  }
  return lines.join('\n');
}

/** Builds a wa.me deep link that opens WhatsApp with the message prefilled. */
export function buildWhatsappLink(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
