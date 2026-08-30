import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { pk, ts, bool, stamps } from "./_shared";

/**
 * Cross-cutting system tables: audit, idempotency, outbox, jobs, flags.
 */

/**
 * Every sensitive mutation (invariant 8).
 *
 * Money and stock attract mistakes and disputes; without this the answer to
 * "who changed this price?" is a shrug.
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: pk(),
    /** Staff user id, or "system" for scheduled work. */
    actorId: text("actor_id").notNull(),
    actorLabel: text("actor_label"),
    /** e.g. `payment.verify`, `price.update`, `settings.iban_change`. */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** JSON. REDACTED before writing - never a full IBAN, token or secret. */
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    /** Correlates an audit entry with the request that caused it. */
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
    index("audit_logs_action_idx").on(t.action, t.createdAt),
  ],
);

/**
 * Idempotency (invariant 14).
 *
 * The UNIQUE index IS the mechanism: the key is claimed by an insert inside the
 * same batch as the effect, so a concurrent duplicate fails the insert and the
 * whole batch rolls back. Customers double-click, networks retry, cron overlaps.
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: pk(),
    key: text("key").notNull(),
    /** order_create | reservation_release | payment_verify | import_confirm ... */
    scope: text("scope").notNull(),
    /** Cart token, session or user - so one customer cannot replay another. */
    ownerToken: text("owner_token"),
    /** JSON of the original result, returned verbatim on replay. */
    resultPayload: text("result_payload"),
    /** pending | completed | failed */
    status: text("status").notNull().default("pending"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_unique").on(t.key, t.scope),
    index("idempotency_keys_expiry_idx").on(t.expiresAt),
  ],
);

/**
 * Transactional outbox.
 *
 * The event is committed with the order; delivery is attempted separately. This
 * is why a failed email cannot roll back a valid order - the customer's purchase
 * does not depend on an SMTP provider being reachable.
 */
export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: pk(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: text("payload").notNull(),
    /** pending | processing | delivered | failed | abandoned */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Exponential backoff target. */
    nextAttemptAt: ts("next_attempt_at"),
    deliveredAt: ts("delivered_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("outbox_events_pending_idx").on(t.status, t.nextAttemptAt),
    index("outbox_events_aggregate_idx").on(t.aggregateType, t.aggregateId),
  ],
);

export const emailLogs = sqliteTable(
  "email_logs",
  {
    id: pk(),
    outboxEventId: text("outbox_event_id").references(() => outboxEvents.id, {
      onDelete: "set null",
    }),
    recipient: text("recipient").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    /** queued | sent | failed | skipped_not_configured */
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("email_logs_recipient_idx").on(t.recipient, t.createdAt),
    index("email_logs_status_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Imports always dry-run first. Nothing is written until a human confirms the
 * report, and price and stock are never silently overwritten.
 */
export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: pk(),
    /** products | variants | prices | inventory | devices | compatibility | ... */
    importType: text("import_type").notNull(),
    filename: text("filename").notNull(),
    /** R2 key in PRIVATE_FILES - an import file may contain cost prices. */
    sourceObjectKey: text("source_object_key"),
    /** uploaded | validating | dry_run_ready | confirmed | applying | completed | failed */
    status: text("status").notNull().default("uploaded"),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsToCreate: integer("rows_to_create").notNull().default(0),
    rowsToUpdate: integer("rows_to_update").notNull().default(0),
    rowsUnchanged: integer("rows_unchanged").notNull().default(0),
    rowsWithWarnings: integer("rows_with_warnings").notNull().default(0),
    rowsWithErrors: integer("rows_with_errors").notNull().default(0),
    createdBy: text("created_by").notNull(),
    confirmedBy: text("confirmed_by"),
    confirmedAt: ts("confirmed_at"),
    completedAt: ts("completed_at"),
    ...stamps(),
  },
  (t) => [index("import_jobs_status_idx").on(t.status, t.createdAt)],
);

export const importJobRows = sqliteTable(
  "import_job_rows",
  {
    id: pk(),
    importJobId: text("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    /** create | update | unchanged | warning | error | skipped */
    outcome: text("outcome").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    message: text("message"),
    rawData: text("raw_data"),
  },
  (t) => [index("import_job_rows_job_idx").on(t.importJobId, t.rowNumber)],
);

export const exportJobs = sqliteTable(
  "export_jobs",
  {
    id: pk(),
    exportType: text("export_type").notNull(),
    /** pending | running | completed | failed */
    status: text("status").notNull().default("pending"),
    /** R2 key in PRIVATE_FILES. Exports can contain personal data. */
    resultObjectKey: text("result_object_key"),
    rowCount: integer("row_count"),
    filters: text("filters"),
    createdBy: text("created_by").notNull(),
    completedAt: ts("completed_at"),
    /** Retention: exports are not kept indefinitely. */
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("export_jobs_status_idx").on(t.status, t.createdAt)],
);

export const featureFlags = sqliteTable(
  "feature_flags",
  {
    id: pk(),
    key: text("key").notNull(),
    description: text("description").notNull(),
    enabled: bool("enabled").notNull().default(false),
    ...stamps(),
  },
  (t) => [uniqueIndex("feature_flags_key_unique").on(t.key)],
);

/** Operational settings, distinct from merchant-facing store_settings. */
export const systemSettings = sqliteTable(
  "system_settings",
  {
    id: pk(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("system_settings_key_unique").on(t.key)],
);

/**
 * Every cron execution. "Did the sweeper run?" should be a query, not log
 * archaeology - and a sweeper that silently stopped is how stock quietly stays
 * reserved forever.
 */
export const scheduledJobRuns = sqliteTable(
  "scheduled_job_runs",
  {
    id: pk(),
    jobName: text("job_name").notNull(),
    /** running | completed | failed */
    status: text("status").notNull(),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at"),
    itemsProcessed: integer("items_processed").notNull().default(0),
    error: text("error"),
    /** JSON summary, e.g. which reservations were released. */
    summary: text("summary"),
  },
  (t) => [index("scheduled_job_runs_job_idx").on(t.jobName, t.startedAt)],
);

/**
 * Installation singleton — the atomic lock for initial-admin bootstrap.
 *
 * The previous guard was "run only while zero staff profiles exist", which is a
 * READ followed by a WRITE. Two simultaneous requests can both read zero and
 * both proceed, producing two administrators from a route that is meant to
 * produce exactly one.
 *
 * `id` is constrained to the literal 'singleton', so the PRIMARY KEY itself is
 * the lock: the first INSERT wins and a concurrent second fails. The claim is
 * taken BEFORE the account is created, so the loser never reaches account
 * creation at all.
 */
export const installationState = sqliteTable(
  "installation_state",
  {
    id: text("id").primaryKey(),
    /** in_progress | completed */
    status: text("status").notNull(),
    claimedAt: ts("claimed_at").notNull(),
    completedAt: ts("completed_at"),
    completedByUserId: text("completed_by_user_id"),
    /**
     * Set once the setup token has been accepted and spent. The token itself is
     * NEVER stored - only the fact that one was consumed, and when.
     */
    tokenConsumedAt: ts("token_consumed_at"),
  },
  (t) => [
    check("installation_state_singleton", sql`${t.id} = 'singleton'`),
    check("installation_state_status", sql`${t.status} IN ('in_progress','completed')`),
  ],
);

/**
 * Bootstrap attempt log, for rate limiting and for after-the-fact review.
 *
 * The IP is stored HASHED: rate limiting needs to recognise a repeat visitor,
 * not to identify them, and an unhashed address on an unauthenticated endpoint
 * is personal data nobody needs.
 *
 * The submitted token is never recorded in any form.
 */
export const bootstrapAttempts = sqliteTable(
  "bootstrap_attempts",
  {
    id: pk(),
    ipHash: text("ip_hash"),
    /** invalid_token | rate_limited | already_installed | claimed | completed | failed */
    outcome: text("outcome").notNull(),
    attemptedAt: ts("attempted_at").notNull(),
  },
  (t) => [index("bootstrap_attempts_recent_idx").on(t.attemptedAt)],
);
