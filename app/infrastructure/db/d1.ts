/**
 * The D1 adapter.
 *
 * Almost a pass-through, because the port was deliberately shaped like D1's
 * API — the 453 statements in this application were written against it, and a
 * port that made the INCUMBENT the special case would have meant rewriting all
 * of them to migrate away from it.
 *
 * It exists so that the Cloudflare deployment keeps running unchanged while the
 * MariaDB path is proved, and so that "does the application still work on
 * Cloudflare?" stays a question the test suite can answer rather than a claim.
 * After cutover this file is deleted; nothing else changes.
 */

import type { SqlDatabase, SqlResult, SqlRunResult, SqlStatement, SqlMeta } from "./sql";

class D1Statement implements SqlStatement {
  private readonly statement: D1PreparedStatement;

  constructor(statement: D1PreparedStatement) {
    this.statement = statement;
  }

  /** The underlying D1 statement, for `batch`. */
  unwrap(): D1PreparedStatement {
    return this.statement;
  }

  bind(...values: unknown[]): SqlStatement {
    return new D1Statement(this.statement.bind(...values));
  }

  async first<T>(): Promise<T | null> {
    return (await this.statement.first<T>()) ?? null;
  }

  async all<T>(): Promise<SqlResult<T>> {
    const result = await this.statement.all<T>();
    return {
      results: result.results,
      success: result.success,
      meta: toMeta(result.meta),
    };
  }

  async run(): Promise<SqlRunResult> {
    const result = await this.statement.run();
    return { success: result.success, meta: toMeta(result.meta) };
  }
}

function toMeta(meta: D1Meta): SqlMeta {
  return {
    changes: meta.changes,
    last_row_id: meta.last_row_id,
    duration: meta.duration,
    ...(meta.rows_read === undefined ? {} : { rows_read: meta.rows_read }),
    ...(meta.rows_written === undefined ? {} : { rows_written: meta.rows_written }),
  };
}

export class D1SqlDatabase implements SqlDatabase {
  readonly dialect = "sqlite" as const;
  private readonly d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
  }

  prepare(sql: string): SqlStatement {
    /*
     * The statement is NOT passed through the MariaDB translator.
     *
     * It is already SQLite, and translating it would be translating it to
     * itself with a chance of a bug. The consequence is that a statement using
     * something MariaDB cannot do keeps working here — which is why
     * `npm run hostinger:sql-audit` exists and runs in CI, rather than relying
     * on the Cloudflare path to notice.
     */
    return new D1Statement(this.d1.prepare(sql));
  }

  async batch<T>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    const prepared = statements.map((statement) => {
      if (!(statement instanceof D1Statement)) {
        throw new Error("batch() received a statement from a different database adapter");
      }
      return statement.unwrap();
    });

    const results = await this.d1.batch<T>(prepared);
    return results.map((result) => ({
      results: result.results,
      success: result.success,
      meta: toMeta(result.meta),
    }));
  }

  /*
   * No `transaction()`.
   *
   * workerd has no interactive transactions, and providing a fake one — a
   * closure that runs statements and hopes — would be worse than not providing
   * it: the reservation path would look transactional on Cloudflare and not be.
   * Code that needs one checks `supportsInteractiveTransactions` and takes the
   * batch path here instead. See app/application/commands/create-order.ts.
   */
}
