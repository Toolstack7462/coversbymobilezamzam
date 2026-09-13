/**
 * The MariaDB adapter.
 *
 * Implements the D1-shaped port over mysql2's promise pool, so the statements
 * the application already has run unchanged. What it adds over D1 is real
 * transactions — which is why the reservation path gets stronger rather than
 * merely equivalent when it moves here.
 *
 * Connection policy is set for SHARED HOSTING, not for a machine we own.
 * Hostinger caps MySQL connections per database user (50 on Web Premium, 100
 * on Cloud Startup — see docs/hostinger/capability-audit.md), and a Node
 * process that opens a pool per worker will exhaust that cap long before it
 * exhausts the CPU. The pool is small, bounded and closed on shutdown.
 */

import mysql from "mysql2/promise";
import type { Pool, PoolConnection, PoolOptions } from "mysql2/promise";
import { translate, orderParameters, type TranslatedStatement } from "./dialect";
import { classifySqlError } from "./sql";
import type {
  InteractiveSqlDatabase,
  SqlDatabase,
  SqlResult,
  SqlRunResult,
  SqlStatement,
  SqlTransaction,
} from "./sql";

export interface MariaDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Hostinger terminates TLS on some tiers and not others; read it from hPanel. */
  ssl?: { rejectUnauthorized: boolean; ca?: string };
  connectionLimit?: number;
  connectTimeoutMs?: number;
}

/**
 * Statement translation is pure and the statement texts are constants in the
 * source, so the same few hundred strings are translated over and over. The
 * cache is bounded because a route that builds SQL by concatenating filters
 * produces a new string per distinct filter combination, and an unbounded
 * cache there is a slow memory leak on a 2 GB plan.
 */
const TRANSLATION_CACHE_LIMIT = 2000;
const translationCache = new Map<string, TranslatedStatement>();

function translateCached(sql: string): TranslatedStatement {
  const hit = translationCache.get(sql);
  if (hit) return hit;
  const translated = translate(sql);
  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
    // Cheapest sound eviction: drop the oldest insertion. Map preserves order.
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(sql, translated);
  return translated;
}

type Executor = Pick<PoolConnection, "execute">;

/**
 * What mysql2 will accept as bind values.
 *
 * The driver types this as a closed union. The values here come from the
 * caller's bind array and are whatever the schema holds — strings, numbers,
 * null and Uint8Array — so they are asserted at this one boundary rather than
 * threaded as `any` through the adapter.
 */
type BindValues = Parameters<PoolConnection["execute"]>[1];

class MariaDbStatement implements SqlStatement {
  private values: readonly unknown[] = [];

  constructor(
    private readonly executor: () => Promise<Executor> | Executor,
    private readonly release: ((executor: Executor) => void) | null,
    private readonly translated: TranslatedStatement,
    private readonly originalSql: string,
  ) {}

  bind(...values: unknown[]): SqlStatement {
    const next = new MariaDbStatement(
      this.executor,
      this.release,
      this.translated,
      this.originalSql,
    );
    next.values = values;
    return next;
  }

  /** The parameters as MariaDB will receive them. Used by `batch`. */
  materialise(): { sql: string; params: unknown[] } {
    return {
      sql: this.translated.sql,
      params: orderParameters(this.values, this.translated.parameterOrder),
    };
  }

  private async exec(): Promise<{ rows: unknown; info: mysql.ResultSetHeader | null; ms: number }> {
    const { sql, params } = this.materialise();
    const started = Date.now();
    const executor = await this.executor();
    try {
      const [rows] = await executor.execute(sql, params as BindValues);
      const info = isResultSetHeader(rows) ? rows : null;
      return { rows, info, ms: Date.now() - started };
    } catch (error) {
      throw decorate(error, this.originalSql);
    } finally {
      if (this.release) this.release(executor);
    }
  }

  async first<T>(): Promise<T | null> {
    const { rows } = await this.exec();
    if (!Array.isArray(rows)) return null;
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>(): Promise<SqlResult<T>> {
    const { rows, info, ms } = await this.exec();
    const results = Array.isArray(rows) ? (rows as T[]) : [];
    return {
      results,
      success: true,
      meta: metaFrom(info, ms, results.length),
    };
  }

  async run(): Promise<SqlRunResult> {
    const { rows, info, ms } = await this.exec();
    return {
      success: true,
      meta: metaFrom(info, ms, Array.isArray(rows) ? rows.length : 0),
    };
  }
}

function isResultSetHeader(value: unknown): value is mysql.ResultSetHeader {
  return (
    typeof value === "object" && value !== null && "affectedRows" in value && !Array.isArray(value)
  );
}

function metaFrom(info: mysql.ResultSetHeader | null, ms: number, rowCount: number) {
  /*
   * `affectedRows` vs D1's `changes`.
   *
   * MariaDB returns 2 for an `ON DUPLICATE KEY UPDATE` that updated a row, and
   * 1 for one that inserted. D1 would report 1 for either. Every call site
   * checks `=== 0` or `=== 1`, so the 2 is normalised away here rather than
   * left for a reader to rediscover.
   *
   * No CLIENT_FOUND_ROWS. The difference between matched and changed rows only
   * shows up when an UPDATE writes a value identical to the one already there,
   * and every `meta.changes` check in this codebase sits behind a WHERE clause
   * that makes that impossible (`WHERE status = 'active'` then `SET status =
   * 'expired'`, and so on). The flag is left at its default because the
   * evidence says it changes nothing, and a global driver flag set on a hunch
   * is a behaviour change hiding in configuration.
   */
  const affected = info?.affectedRows ?? 0;
  return {
    changes: affected === 2 ? 1 : affected,
    last_row_id: info?.insertId ?? 0,
    duration: ms,
    rows_read: rowCount,
    rows_written: affected,
  };
}

function decorate(error: unknown, sql: string): unknown {
  if (error instanceof Error) {
    // Keep the driver's own properties — classifySqlError reads `code`.
    error.message = `${error.message}\n  statement: ${sql.trim().replace(/\s+/g, " ").slice(0, 300)}`;
  }
  return error;
}

export class MariaDbDatabase implements InteractiveSqlDatabase {
  private readonly pool: Pool;
  private closed = false;

  constructor(config: MariaDbConfig) {
    const options: PoolOptions = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,

      waitForConnections: true,
      // Small on purpose. See the file header: the per-user connection cap on
      // shared hosting is the binding constraint, not throughput.
      connectionLimit: config.connectionLimit ?? 8,
      queueLimit: 0,
      connectTimeout: config.connectTimeoutMs ?? 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,

      // Epoch milliseconds are stored in BIGINT. mysql2 returns BIGINT as a
      // JS number unless asked otherwise, and every value in this schema is
      // far inside Number.MAX_SAFE_INTEGER (an epoch-millisecond timestamp is
      // ~1.8e12; the safe limit is 9.0e15). Money is minor units and smaller
      // still. Returning strings instead would break every comparison in the
      // application, so this is left at the default AND asserted by a test.
      supportBigNumbers: false,

      // The schema stores every date as an integer. If a DATETIME column is
      // ever added, this keeps it a string rather than a Date in the server's
      // local timezone, which is the classic way a UTC-only system acquires a
      // silent Europe/Rome offset.
      dateStrings: true,

      // One statement per call. Without this, a bind value that reached a
      // statement unescaped could append a second statement.
      multipleStatements: false,

      charset: "utf8mb4_unicode_ci",
      timezone: "Z",
    };

    /*
     * `ssl` is attached only when configured.
     *
     * Under `exactOptionalPropertyTypes`, setting it to `undefined` is not
     * the same as leaving it out — and mysql2 reads the KEY's presence, so
     * an explicit undefined would be a TLS decision made by accident.
     * Whether Hostinger requires TLS is read from hPanel per environment;
     * see docs/hostinger/environment-reference.md.
     */
    this.pool = mysql.createPool(config.ssl ? { ...options, ssl: config.ssl } : options);
  }

  prepare(sql: string): SqlStatement {
    const translated = translateCached(sql);
    return new MariaDbStatement(
      () => this.pool.getConnection(),
      (executor) => (executor as PoolConnection).release(),
      translated,
      sql,
    );
  }

  /**
   * Atomic, in order, on ONE connection.
   *
   * D1's `batch` is a transaction that the caller cannot see inside. This is
   * the same contract: every statement commits together or none does. Unlike
   * D1, a failure here must be rolled back explicitly — MariaDB aborts the
   * failing STATEMENT but leaves the transaction open and the earlier
   * statements applied, which is the single most dangerous difference between
   * the two engines and the reason this method exists rather than a loop.
   */
  async batch<T>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const out: SqlResult<T>[] = [];

      for (const statement of statements) {
        if (!(statement instanceof MariaDbStatement)) {
          throw new Error("batch() received a statement from a different database adapter");
        }
        const { sql, params } = statement.materialise();
        const started = Date.now();
        let rows: unknown;
        try {
          [rows] = await connection.execute(sql, params as BindValues);
        } catch (error) {
          throw decorate(error, sql);
        }
        const info = isResultSetHeader(rows) ? rows : null;
        const results = Array.isArray(rows) ? (rows as T[]) : [];
        out.push({
          results,
          success: true,
          meta: metaFrom(info, Date.now() - started, results.length),
        });
      }

      await connection.commit();
      return out;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // A rollback that fails means the connection is unusable. Destroying it
        // is the only safe response; returning it to the pool would hand the
        // next request an open transaction.
        connection.destroy();
        throw error;
      }
      throw error;
    } finally {
      // `destroy()` above already removed it; releasing twice is a no-op.
      connection.release();
    }
  }

  /**
   * An interactive transaction: read, decide, write, all under one lock scope.
   *
   * Retries only on deadlock and lock-wait timeout, which are transient by
   * definition — InnoDB picks a victim and the loser is expected to try again.
   * Nothing else is retried: re-running a statement that failed a CHECK would
   * fail it again, and re-running one that succeeded would double-apply it.
   */
  async transaction<T>(
    run: (tx: SqlTransaction) => Promise<T>,
    options: { retries?: number } = {},
  ): Promise<T> {
    const retries = options.retries ?? 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();

        const tx: SqlTransaction = {
          prepare: (sql: string) =>
            new MariaDbStatement(() => connection, null, translateCached(sql), sql),
        };

        const value = await run(tx);
        await connection.commit();
        return value;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          connection.destroy();
        }

        lastError = error;
        const failure = classifySqlError(error);
        if (failure.kind !== "deadlock" && failure.kind !== "lock_timeout") throw error;
        if (attempt === retries) throw error;

        // Back off with jitter. Two transactions that deadlocked and then
        // retried in lockstep would deadlock again on the same schedule.
        const delay = 20 * 2 ** attempt + Math.floor(Math.random() * 20);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } finally {
        connection.release();
      }
    }

    throw lastError;
  }

  /** Readiness, not liveness: a pool that cannot reach the server is not ready. */
  async ping(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  }

  /**
   * Closes the pool.
   *
   * Called from the graceful-shutdown path. Without it, a redeploy leaves
   * connections open on the server until they time out, and on a plan with a
   * per-user cap of 50 a few redeploys in a row exhaust it.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

export function createMariaDb(config: MariaDbConfig): MariaDbDatabase {
  return new MariaDbDatabase(config);
}

export type { SqlDatabase };
