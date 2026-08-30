import type { Money } from "~/domain/pricing/money";
import type { CompatibilityRecord } from "~/domain/compatibility/resolve";
import type { StockLevel } from "~/domain/inventory/availability";
import type { OrderStatus } from "~/domain/orders/status";
import type { PaymentStatus } from "~/domain/payments/status";

/**
 * Ports: what the application layer needs FROM the outside world, expressed as
 * interfaces it owns.
 *
 * Infrastructure implements these. The domain layer never sees them at all.
 * Clock and IdGenerator look fussy until you try to test reservation expiry or
 * assert an order number - injecting them makes time and identity deterministic.
 */

// ── Primitives ───────────────────────────────────────────────────────────────

export interface Clock {
  /** Epoch milliseconds, UTC. */
  now(): number;
  /** For formatting only. Storage is always the number above. */
  nowDate(): Date;
}

export interface IdGenerator {
  /** Monotonic ULID-style id. Good index locality without leaking a count. */
  generate(): string;
  /** CSPRNG bytes, for order numbers and tracking tokens. */
  randomBytes(length: number): Uint8Array;
}

export interface Encryptor {
  /** AES-GCM. Returns an opaque string safe to store. */
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export interface AuditEntry {
  actorId: string;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ipAddress?: string | null;
}

export interface AuditLogger {
  /**
   * Implementations MUST redact secrets before writing. A full IBAN reaching
   * the audit table is the same disclosure as logging it.
   */
  record(entry: AuditEntry): Promise<void>;
}

export interface EmailMessage {
  to: string;
  template: string;
  subject: string;
  variables: Record<string, string>;
}

export interface EmailSender {
  /**
   * Returns `skipped` when no provider is configured. The store must work
   * without email: a failed send never rolls back a valid order (see the
   * outbox in docs/architecture.md).
   */
  send(
    message: EmailMessage,
  ): Promise<{ status: "sent" | "failed" | "skipped"; id?: string; error?: string }>;
}

export interface MediaStorage {
  putPublic(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  putPrivate(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  getPrivate(key: string): Promise<ArrayBuffer | null>;
  deletePublic(key: string): Promise<void>;
  deletePrivate(key: string): Promise<void>;
  /** Public URL for MEDIA only. There is deliberately no private equivalent. */
  publicUrl(key: string): string | null;
}

// ── Repositories ─────────────────────────────────────────────────────────────

export interface VariantPricing {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantLabel: string | null;
  imageKey: string | null;
  price: Money;
  priorPrice30d: Money | null;
  active: boolean;
  availableOnline: boolean;
  availableForPickup: boolean;
}

export interface ProductRepository {
  findBySlug(slug: string, locale: string): Promise<ProductDetail | null>;
  listForCollection(input: CollectionQuery): Promise<CollectionResult>;
  /** Authoritative prices, re-read inside the order transaction. */
  getPricingForVariants(
    variantIds: readonly string[],
    channel: "online" | "in_store",
  ): Promise<VariantPricing[]>;
  getCompatibilityRecords(productId: string): Promise<CompatibilityRecord[]>;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  brandName: string | null;
  accessoryType: string | null;
  images: { key: string; alt: string | null; width: number; height: number }[];
  variants: VariantPricing[];
  compatibility: CompatibilityRecord[];
  specifications: { key: string; value: string; unit: string | null }[];
}

export interface CollectionQuery {
  locale: string;
  categorySlug?: string;
  deviceModelId?: string | null;
  search?: string;
  page: number;
  perPage: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "newest";
}

export interface CollectionResult {
  items: VariantPricing[];
  total: number;
  page: number;
  perPage: number;
}

export interface InventoryRepository {
  getLevels(variantIds: readonly string[], locationId: string): Promise<StockLevel[]>;
  /**
   * Conditional reservation. Returns false when the stock is gone.
   *
   * This is the oversell guard: the condition lives in the SQL WHERE clause so
   * the database arbitrates, and no read-then-write window exists.
   */
  tryReserve(variantId: string, locationId: string, quantity: number): Promise<boolean>;
  release(reservationId: string, reason: string): Promise<void>;
}

export interface OrderRepository {
  findByNumber(orderNumber: string): Promise<OrderSummary | null>;
  findByTrackingToken(token: string): Promise<OrderSummary | null>;
  updateStatus(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: string,
    reason?: string,
  ): Promise<void>;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  grandTotal: Money;
  createdAt: number;
  reservationExpiresAt: number | null;
}

export interface SettingsRepository {
  /** All merchant settings as a flat map, for the configuration gates. */
  all(): Promise<Record<string, string>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, actorId: string): Promise<void>;
}

export interface SearchIndex {
  /** Never authoritative. Rebuildable from D1 at any time. */
  search(query: string, locale: string, limit: number): Promise<string[]>;
  indexProduct(productId: string): Promise<void>;
  removeProduct(productId: string): Promise<void>;
  rebuild(): Promise<number>;
}

/** Everything a use case may need, assembled once per request. */
export interface AppContext {
  clock: Clock;
  ids: IdGenerator;
  encryptor: Encryptor;
  audit: AuditLogger;
  email: EmailSender;
  media: MediaStorage;
  products: ProductRepository;
  inventory: InventoryRepository;
  orders: OrderRepository;
  settings: SettingsRepository;
  search: SearchIndex;
  requestId: string;
}
