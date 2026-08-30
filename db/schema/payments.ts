import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, bool, money, currency, stamps, archivable, sortOrder } from "./_shared";
import { orders } from "./orders";

/**
 * Manual payments. The site never takes money.
 *
 * The authoritative record of whether money arrived is the merchant's bank
 * account or merchant app - not this database. What is stored here is what an
 * authorised human OBSERVED there, with who, when and how much.
 */

export const paymentMethods = sqliteTable(
  "payment_methods",
  {
    id: pk(),
    code: text("code").notNull(),
    /**
     * bank_transfer | instant_bank_transfer | satispay | bancomat_pay |
     * pay_at_pickup | other_manual
     */
    methodType: text("method_type").notNull(),

    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionIt: text("description_it"),
    descriptionEn: text("description_en"),

    /**
     * Ships FALSE for every method. A method is advertised only once its
     * merchant data exists; a half-configured one sends money to the wrong
     * place (invariant 12).
     */
    active: bool("active").notNull().default(false),
    sortOrder: sortOrder(),

    beneficiaryName: text("beneficiary_name"),
    /**
     * AES-GCM ciphertext. Key lives in a Cloudflare secret, never in the repo.
     * NEVER logged, never exported, never in an error message.
     */
    accountIdentifierEncrypted: text("account_identifier_encrypted"),
    /** e.g. "IT** **** **** **** **** 1234" - so ordinary screens never decrypt. */
    accountIdentifierMasked: text("account_identifier_masked"),
    /** R2 key for a merchant QR image, in the PUBLIC bucket. */
    merchantQrKey: text("merchant_qr_key"),

    instructionsIt: text("instructions_it"),
    instructionsEn: text("instructions_en"),
    /** Shown only in the admin. What staff should check, and where. */
    staffInstructions: text("staff_instructions"),

    /** How long stock is held for an order using this method. */
    reservationMinutes: integer("reservation_minutes").notNull().default(1440),
    eligibleForShipping: bool("eligible_for_shipping").notNull().default(true),
    eligibleForPickup: bool("eligible_for_pickup").notNull().default(true),
    minAmount: money("min_amount"),
    maxAmount: money("max_amount"),

    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("payment_methods_code_unique").on(t.code)],
);

export const orderPayments = sqliteTable(
  "order_payments",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paymentMethodId: text("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id, { onDelete: "restrict" }),

    /**
     * awaiting_customer_contact | awaiting_payment | proof_received |
     * under_verification | verified | partially_paid | overpaid | rejected |
     * expired | refunded | cancelled
     *
     * `verified` is reachable ONLY through the verification use case, which
     * requires a staff user with payment.verify plus step-up (invariant 6).
     */
    status: text("status").notNull().default("awaiting_customer_contact"),

    amountExpected: money("amount_expected").notNull(),
    /** What the customer says they sent. Not evidence. */
    amountClaimed: money("amount_claimed"),
    /** What staff actually saw in the account. */
    amountReceived: money("amount_received"),
    currency: currency(),

    /** Bank or app reference. Duplicates are FLAGGED, never auto-rejected. */
    transactionReference: text("transaction_reference"),

    verifiedBy: text("verified_by"),
    verifiedAt: ts("verified_at"),
    /** Recorded when a reference could not be supplied. Required if so. */
    verificationNote: text("verification_note"),
    rejectedReason: text("rejected_reason"),

    ...stamps(),
  },
  (t) => [
    index("order_payments_order_idx").on(t.orderId),
    index("order_payments_status_idx").on(t.status, t.createdAt),
    // Duplicate-reference detection for the verification queue.
    index("order_payments_reference_idx").on(t.transactionReference),
  ],
);

/**
 * Optional. A customer may equally just send a message.
 *
 * Only the PRIVATE bucket key is stored - never a URL. An uploaded proof moves
 * payment to `proof_received` and no further: it is something for a human to
 * look at, not evidence of settlement.
 */
export const paymentProofs = sqliteTable(
  "payment_proofs",
  {
    id: pk(),
    orderPaymentId: text("order_payment_id")
      .notNull()
      .references(() => orderPayments.id, { onDelete: "cascade" }),
    /** Random key in PRIVATE_FILES. The upload filename is never trusted. */
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    /** Filename as supplied, for display only. Never used as a path. */
    originalFilenameDisplay: text("original_filename_display"),
    uploadedAt: ts("uploaded_at").notNull(),
    uploadedByIp: text("uploaded_by_ip"),
    /** Retention policy deletion. */
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("payment_proofs_payment_idx").on(t.orderPaymentId)],
);

/** Every proof read is logged. Personal financial data leaves a trail. */
export const paymentProofAccessLogs = sqliteTable(
  "payment_proof_access_logs",
  {
    id: pk(),
    proofId: text("proof_id")
      .notNull()
      .references(() => paymentProofs.id, { onDelete: "cascade" }),
    accessedBy: text("accessed_by").notNull(),
    accessedAt: ts("accessed_at").notNull(),
    ipAddress: text("ip_address"),
  },
  (t) => [index("payment_proof_access_proof_idx").on(t.proofId, t.accessedAt)],
);

export const paymentStatusHistory = sqliteTable(
  "payment_status_history",
  {
    id: pk(),
    orderPaymentId: text("order_payment_id")
      .notNull()
      .references(() => orderPayments.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    amountAtTransition: money("amount_at_transition"),
    reason: text("reason"),
    actor: text("actor").notNull(),
    /**
     * True when this reverses a previous verification. The original is never
     * erased - the evidence that someone got it wrong is part of the record.
     */
    isCorrection: bool("is_correction").notNull().default(false),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("payment_status_history_payment_idx").on(t.orderPaymentId, t.createdAt)],
);
