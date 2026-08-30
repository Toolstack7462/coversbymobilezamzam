import { type Money, format as formatMoney } from "../pricing/money";

/**
 * Builds the pre-filled WhatsApp Click-to-Chat message.
 *
 * Composed on the SERVER so no client code decides what goes in it. The
 * exclusion list below is therefore testable, and it is tested.
 *
 * A URL in a chat gets forwarded, screenshotted and backed up to a cloud the
 * shop does not control, so the message carries only what staff need to find the
 * order - never an address, never a token, never an internal id.
 */

export interface WhatsAppLineItem {
  readonly quantity: number;
  readonly productName: string;
  readonly variantLabel?: string | null;
}

export interface WhatsAppMessageInput {
  readonly orderNumber: string;
  readonly customerFirstName: string;
  readonly customerLastName: string;
  readonly total: Money;
  readonly paymentMethodName: string;
  readonly deliveryMethod: "shipping" | "pickup";
  readonly items: readonly WhatsAppLineItem[];
  readonly locale?: string;
}

/**
 * Italian only for now: the merchant reads Italian, and this message is written
 * TO them. An English-speaking customer still gets an English interface and
 * English on-page instructions.
 */
export function buildWhatsAppMessage(input: WhatsAppMessageInput): string {
  const {
    orderNumber,
    customerFirstName,
    customerLastName,
    total,
    paymentMethodName,
    deliveryMethod,
    items,
  } = input;

  const delivery = deliveryMethod === "pickup" ? "Ritiro in negozio" : "Spedizione";

  const lines = [
    "Buongiorno, desidero confermare il mio ordine.",
    "",
    `Ordine: ${orderNumber}`,
    `Totale: ${formatMoney(total)}`,
    `Metodo di pagamento: ${paymentMethodName}`,
    `Consegna: ${delivery}`,
    "",
    "Prodotti:",
    ...items.map(
      (item) =>
        `${item.quantity} × ${item.productName}${item.variantLabel ? ` — ${item.variantLabel}` : ""}`,
    ),
    "",
    `Nome: ${customerFirstName} ${customerLastName}`,
    "",
    "Attendo le istruzioni per completare il pagamento.",
  ];

  return lines.join("\n");
}

/**
 * The full click-to-chat URL.
 *
 * @param whatsappNumber - international format, digits only, no + and no spaces
 * @returns null when no number is configured, so the CTA renders nothing rather
 *   than a broken link or a placeholder (invariant 12)
 */
export function buildWhatsAppUrl(whatsappNumber: string | null, message: string): string | null {
  if (!whatsappNumber) return null;

  const digits = whatsappNumber.replace(/\D/g, "");
  // A too-short number is a misconfiguration, not something to "try anyway" -
  // wa.me would open a chat with the wrong person.
  if (digits.length < 8) return null;

  // encodeURIComponent over the whole body. Newlines, accented characters
  // (è, à, ò), the euro sign and × all survive this; Italian product names
  // break naive encoding routinely.
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Fields that must NEVER appear in the message. Asserted by
 * tests/unit/whatsapp-message.test.ts against a realistic order.
 */
export const EXCLUDED_FROM_MESSAGE = [
  "full delivery address",
  "internal order id",
  "tracking token",
  "payment proof",
  "internal notes",
  "customer password or account data",
  "any security token",
] as const;
