/**
 * Per-request database instrumentation.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * "This route is efficient" is not a claim anyone can check. "This route runs
 * 34 queries and spends 41 ms in the database" is. Every performance change in
 * docs/hostinger/database-performance.md is recorded as a before and after
 * from this counter, not from a reading of the code.
 *
 * It is also how N+1 queries get found. A product grid that runs one query per
 * card looks fine in the source — the query is inside a helper, called from a
 * map — and looks like 1 + 26 queries here.
 *
 * ── WHY ASYNCLOCALSTORAGE ───────────────────────────────────────────────────
 *
 * A request's loaders run concurrently and interleave with other requests'.
 * A module-level counter would attribute one page's queries to whichever
 * request happened to finish last. `AsyncLocalStorage` follows the async
 * context, so the count belongs to the request that caused it.
 *
 * ── WHAT IT COSTS ───────────────────────────────────────────────────────────
 *
 * `AsyncLocalStorage` has a real cost on very hot paths, so this is OFF unless
 * a request opts in: `withQueryMetrics` is called by the server only when the
 * environment is not production, or when the caller asked for a
 * `Server-Timing` header. In production the store is empty and `record()` is a
 * single undefined check.
 *
 * Node-only. Nothing in the Cloudflare path imports this file; the Worker's
 * observability comes from Cloudflare's own analytics.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface QueryRecord {
  /** The statement, normalised: literals stripped so repeats group together. */
  shape: string;
  durationMs: number;
  rows: number;
}

export interface QueryMetrics {
  queries: QueryRecord[];
  startedAt: number;
}

const storage = new AsyncLocalStorage<QueryMetrics>();

/** Runs `fn` with a fresh counter, and returns both its value and the counts. */
export async function withQueryMetrics<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; metrics: QueryMetrics }> {
  const metrics: QueryMetrics = { queries: [], startedAt: Date.now() };
  const value = await storage.run(metrics, fn);
  return { value, metrics };
}

/** Called by the adapter after every statement. A no-op when not instrumented. */
export function record(sql: string, durationMs: number, rows: number): void {
  const metrics = storage.getStore();
  if (metrics === undefined) return;
  // Bounded: a runaway loop must not turn instrumentation into the memory leak
  // it was added to find.
  if (metrics.queries.length >= 2000) return;
  metrics.queries.push({ shape: shapeOf(sql), durationMs, rows });
}

export function currentMetrics(): QueryMetrics | undefined {
  return storage.getStore();
}

/**
 * Reduces a statement to its shape, so `WHERE id = ?` run 26 times groups into
 * one row with a count of 26 — which is what makes an N+1 visible at a glance
 * rather than as 26 lines that look different because their literals differ.
 */
export function shapeOf(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export interface QuerySummary {
  total: number;
  totalMs: number;
  slowest: QueryRecord | null;
  /** Statement shapes run more than once, worst first. The N+1 report. */
  repeated: { shape: string; count: number; totalMs: number }[];
}

export function summarise(metrics: QueryMetrics): QuerySummary {
  const byShape = new Map<string, { count: number; totalMs: number }>();
  let totalMs = 0;
  let slowest: QueryRecord | null = null;

  for (const query of metrics.queries) {
    totalMs += query.durationMs;
    if (slowest === null || query.durationMs > slowest.durationMs) slowest = query;
    const entry = byShape.get(query.shape) ?? { count: 0, totalMs: 0 };
    entry.count += 1;
    entry.totalMs += query.durationMs;
    byShape.set(query.shape, entry);
  }

  return {
    total: metrics.queries.length,
    totalMs: Math.round(totalMs * 100) / 100,
    slowest,
    repeated: [...byShape]
      .filter(([, entry]) => entry.count > 1)
      .map(([shape, entry]) => ({ shape, count: entry.count, totalMs: entry.totalMs }))
      .sort((a, b) => b.count - a.count),
  };
}
