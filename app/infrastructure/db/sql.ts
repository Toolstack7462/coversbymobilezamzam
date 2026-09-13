/**
 * The database port.
 *
 * Shaped like D1's API on purpose. The application has 453 statements written
 * against `prepare(...).bind(...).first()/all()/run()` and `batch()`, and the
 * cheapest correct migration is one where those call sites do not change at
 * all — they are typed against this interface instead of `D1Database`, and the
 * runtime supplies either the Cloudflare adapter or the MariaDB one.
 *
 * That is also what keeps Cloudflare recoverable. Until cutover is approved,
 * the same code runs unmodified on Workers; afterwards, the D1 adapter is the
 * only file that has to be deleted.
 *
 * ONE ADDITION, deliberately. D1 has no interactive transaction — `batch()` is
 * the only atomic unit workerd offers — so order creation was written as one
 * batch with the oversell guard expressed as a CHECK constraint that ABORTS
 * the batch. MariaDB has real transactions, so `transaction()` exists here and
 * the MariaDB path uses row locks and inspected row counts, which is stronger.
 * The D1 adapter implements `transaction()` by collecting the statements and
 * issuing one `batch()`, so behaviour is preserved on both.
 */

export interface SqlMeta {
  /**
   * Rows changed by the statement.
   *
   * D1 reports SQLite's `changes()`. mysql2 reports `affectedRows`. They agree
   * at every call site in this codebase because every one is a conditional
   * claim whose new value necessarily differs from the old — see
   * docs/hostinger/mariadb-schema-map.md for the enumeration and the test that
   * pins it. No driver flag is set to force one reading over the other.
   */
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read?: number;
  rows_written?: number;
}

export interface SqlResult<T> {
  results: T[];
  success: boolean;
  meta: SqlMeta;
}

export interface SqlRunResult {
  success: boolean;
  meta: SqlMeta;
}

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<SqlRunResult>;
}

export type SqlDialect = "sqlite" | "mariadb";

export interface SqlDatabase {
  /**
   * Which engine is underneath.
   *
   * Read by the two statements that genuinely cannot be written once — see
   * bootstrap-admin.ts. Everything else goes through the translator and never
   * asks. A third reader of this field is a sign that something belongs in the
   * translator instead.
   */
  readonly dialect: SqlDialect;
  prepare(sql: string): SqlStatement;
  /**
   * Runs every statement atomically, in order.
   *
   * On D1 this is `D1Database.batch`. On MariaDB it is one transaction on one
   * pooled connection. Either way: all of it, or none of it.
   */
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}

/** A handle scoped to an open transaction. Statements run on ONE connection. */
export interface SqlTransaction {
  prepare(sql: string): SqlStatement;
}

/**
 * Databases that can hold a transaction open across awaits.
 *
 * MariaDB can; D1 cannot. Code that needs `SELECT ... FOR UPDATE` followed by
 * a decision followed by a write must check for this rather than assume it, so
 * that the Cloudflare path keeps working until cutover.
 */
export interface InteractiveSqlDatabase extends SqlDatabase {
  transaction<T>(
    run: (tx: SqlTransaction) => Promise<T>,
    options?: { retries?: number },
  ): Promise<T>;
}

export function supportsInteractiveTransactions(db: SqlDatabase): db is InteractiveSqlDatabase {
  return typeof (db as InteractiveSqlDatabase).transaction === "function";
}

/**
 * The errors the application reacts to by name.
 *
 * `create-order.ts` distinguishes "somebody took the last unit" from "the
 * database is broken" by matching the constraint name in the driver's error
 * text, and the two drivers phrase it differently. Classifying here means the
 * call site keeps one test instead of two.
 */
export type SqlFailure =
  | { kind: "check_violation"; constraint: string | null }
  | { kind: "unique_violation"; constraint: string | null }
  | { kind: "foreign_key_violation"; constraint: string | null }
  | { kind: "deadlock" }
  | { kind: "lock_timeout" }
  | { kind: "other" };

export function classifySqlError(error: unknown): SqlFailure {
  const message = error instanceof Error ? error.message : String(error);

  // MariaDB error codes, which mysql2 exposes on the error object.
  const code = (error as { code?: string; errno?: number } | null)?.code;
  const errno = (error as { errno?: number } | null)?.errno;

  if (code === "ER_LOCK_DEADLOCK" || errno === 1213) return { kind: "deadlock" };
  if (code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1205) return { kind: "lock_timeout" };
  if (code === "ER_CONSTRAINT_FAILED" || errno === 4025) {
    // MariaDB: "CONSTRAINT `name` failed for `db`.`table`"
    return {
      kind: "check_violation",
      constraint: /CONSTRAINT `([^`]+)`/.exec(message)?.[1] ?? null,
    };
  }
  if (code === "ER_DUP_ENTRY" || errno === 1062) {
    return { kind: "unique_violation", constraint: /for key '([^']+)'/.exec(message)?.[1] ?? null };
  }
  if (
    code === "ER_NO_REFERENCED_ROW_2" ||
    code === "ER_ROW_IS_REFERENCED_2" ||
    errno === 1452 ||
    errno === 1451
  ) {
    return {
      kind: "foreign_key_violation",
      constraint: /CONSTRAINT `([^`]+)`/.exec(message)?.[1] ?? null,
    };
  }

  // SQLite / D1 phrasings.
  if (/CHECK constraint failed:?\s*(\S+)?/i.test(message)) {
    return {
      kind: "check_violation",
      constraint: /CHECK constraint failed:\s*(\S+)/i.exec(message)?.[1] ?? null,
    };
  }
  if (/UNIQUE constraint failed:\s*(\S+)/i.test(message)) {
    return {
      kind: "unique_violation",
      constraint: /UNIQUE constraint failed:\s*(\S+)/i.exec(message)?.[1] ?? null,
    };
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return { kind: "foreign_key_violation", constraint: null };
  }

  return { kind: "other" };
}
