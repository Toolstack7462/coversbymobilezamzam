import { describe, it, expect } from "vitest";
import { money } from "~/domain/pricing/money";
import {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  type WhatsAppMessageInput,
} from "~/domain/orders/whatsapp-message";

const ORDER: WhatsAppMessageInput = {
  orderNumber: "ITA-20260830-AB12CD",
  customerFirstName: "Mario",
  customerLastName: "Rossi",
  total: money(3990),
  paymentMethodName: "Satispay",
  deliveryMethod: "shipping",
  items: [
    { quantity: 1, productName: "Cover MagSafe per iPhone 16 Pro", variantLabel: "Nero" },
    { quantity: 2, productName: "Vetro protettivo per iPhone 16 Pro", variantLabel: null },
  ],
};

describe("the message body", () => {
  it("carries what staff need to find and answer the order", () => {
    const message = buildWhatsAppMessage(ORDER);
    expect(message).toContain("ITA-20260830-AB12CD");
    expect(message).toContain("Mario Rossi");
    expect(message).toContain("39,90");
    expect(message).toContain("Satispay");
    expect(message).toContain("Spedizione");
    expect(message).toContain("1 × Cover MagSafe per iPhone 16 Pro — Nero");
    expect(message).toContain("2 × Vetro protettivo per iPhone 16 Pro");
  });

  it("says pickup when the order is for collection", () => {
    const message = buildWhatsAppMessage({ ...ORDER, deliveryMethod: "pickup" });
    expect(message).toContain("Ritiro in negozio");
    expect(message).not.toContain("Spedizione");
  });

  it("omits the separator for a variant-less line", () => {
    const message = buildWhatsAppMessage(ORDER);
    expect(message).not.toContain("Vetro protettivo per iPhone 16 Pro — ");
  });

  describe("what must never appear", () => {
    // A URL in a chat gets forwarded, screenshotted and backed up to a cloud the
    // shop does not control.
    const message = buildWhatsAppMessage(ORDER);

    it("contains no delivery address", () => {
      expect(message).not.toMatch(/via |viale |piazza |CAP|\b\d{5}\b/i);
    });

    it("contains no internal identifier or token", () => {
      expect(message).not.toMatch(/ord_[a-z0-9]/i);
      expect(message).not.toMatch(/token/i);
    });

    it("contains no email address", () => {
      expect(message).not.toMatch(/@/);
    });

    it("never asks for payment credentials", () => {
      // A message asking for these is indistinguishable from phishing.
      expect(message).not.toMatch(/password|PIN|OTP|IBAN|carta|CVV/i);
    });
  });
});

describe("the click-to-chat URL", () => {
  it("builds a wa.me link with an encoded body", () => {
    const url = buildWhatsAppUrl("393501234567", buildWhatsAppMessage(ORDER));
    expect(url).toContain("https://wa.me/393501234567?text=");
  });

  it("survives a round trip with accents, the euro sign and the multiplication sign", () => {
    // Italian product names break naive encoding routinely.
    const message = buildWhatsAppMessage({
      ...ORDER,
      items: [{ quantity: 3, productName: "Caricatore rapido è però ünico", variantLabel: "20W" }],
    });
    const url = buildWhatsAppUrl("393501234567", message)!;
    const decoded = decodeURIComponent(url.split("?text=")[1]!);
    expect(decoded).toBe(message);
    expect(decoded).toContain("è però ünico");
    expect(decoded).toContain("3 ×");
    expect(decoded).toContain("€");
  });

  it("encodes newlines rather than truncating at the first one", () => {
    const url = buildWhatsAppUrl("393501234567", buildWhatsAppMessage(ORDER))!;
    expect(url).toContain("%0A");
    expect(url).not.toMatch(/\n/);
  });

  it("returns null when no number is configured, so the CTA renders nothing", () => {
    expect(buildWhatsAppUrl(null, "ciao")).toBeNull();
    expect(buildWhatsAppUrl("", "ciao")).toBeNull();
  });

  it("returns null for a number too short to be real", () => {
    // Better no button than a chat opened with the wrong person.
    expect(buildWhatsAppUrl("123", "ciao")).toBeNull();
  });

  it("strips formatting a merchant might paste in", () => {
    const url = buildWhatsAppUrl("+39 350 123 4567", "ciao");
    expect(url).toContain("https://wa.me/393501234567?");
  });
});
