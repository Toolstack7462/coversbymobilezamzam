import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Shared column builders.
 *
 * Conventions these encode, so they cannot drift table by table:
 * - Primary keys are text ULID-style ids from the IdGenerator port. Sequential
 *   integers would leak a count and make the next record guessable.
 * - Timestamps are integer epoch milliseconds, UTC, always (invariant 10).
 * - Booleans are integer 0/1 because SQLite has no boolean type.
 * - Money is integer minor units and always travels beside a currency column
 *   (invariant 1). There is no float money column anywhere in this schema.
 */

export const pk = () => text("id").primaryKey();

/** Integer epoch milliseconds, UTC. */
export const ts = (name: string) => integer(name);

/**
 * The same INTEGER column, but surfaced to TypeScript as a Date.
 *
 * Better Auth hands the adapter Date objects and expects them back. Storage is
 * identical - epoch milliseconds - so this changes serialisation only and needs
 * no migration. Used ONLY for the Better Auth-owned tables; project tables use
 * `ts` and work in plain numbers, which keeps the Clock port meaningful.
 */
export const authTs = (name: string) => integer(name, { mode: "timestamp_ms" });

/** SQLite has no boolean. Drizzle maps 0/1 for us. */
export const bool = (name: string) => integer(name, { mode: "boolean" });

/** Integer minor units. 3990 = 39,90. Never a float. */
export const money = (name: string) => integer(name);

/** ISO 4217. Stored per amount so multi-currency is additive later. */
export const currency = (name = "currency") => text(name).notNull().default("EUR");

/** created_at / updated_at, both required. */
export const stamps = () => ({
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * Soft delete. Null means active.
 * Anything a historical transaction references is archived, never deleted
 * (invariant 13).
 */
export const archivable = () => ({
  archivedAt: ts("archived_at"),
});

/** BCP 47 language tag. "it" is the default and the fallback. */
export const locale = () => text("locale").notNull();

/** Merchant-controlled display order. Ties break on name, deterministically. */
export const sortOrder = (name = "sort_order") => integer(name).notNull().default(0);
