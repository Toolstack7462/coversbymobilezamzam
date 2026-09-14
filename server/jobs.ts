/**
 * Scheduled work on the Node runtime.
 *
 * ── WHY THIS FILE HAD TO EXIST ──────────────────────────────────────────────
 *
 * On Cloudflare, `workers/app.ts` exports a `scheduled` handler and the
 * platform calls it every five minutes. Nothing calls it on Hostinger. Without
 * an equivalent the reservation sweeper never runs, and the consequence is not
 * subtle: stock stays reserved against abandoned orders forever, `available`
 * falls to zero, and the shop stops being able to sell things it has on the
 * shelf. The failure is silent and it gets worse every day.
 *
 * ── TWO WAYS IN, BECAUSE ONE OF THEM MIGHT NOT EXIST ────────────────────────
 *
 * Capability check C-4 asks whether Hostinger's cron can run `node` at all —
 * whether it is on the PATH, and which one. That is not yet answered, so the
 * design does not depend on the answer:
 *
 *   1. `scripts/hostinger/run-job.mjs`, for a cron line that can run node.
 *   2. `POST /api/jobs/run`, for a cron line that can only run `curl`. The
 *      application is already running; a request into it costs no new process
 *      and no new database connection pool.
 *
 * Both call `runJob` below, so there is one implementation and one place where
 * overlap and error handling are decided.
 *
 * ── THE SECRET IS A HEADER, NEVER A QUERY STRING ────────────────────────────
 *
 * A cron command line appears in hPanel's job list and in process listings, so
 * a secret in a URL is a secret on a screen somebody else can read. It goes in
 * a header, and the endpoint 404s rather than 401s when the header is wrong:
 * an unauthenticated caller learns nothing about whether the endpoint exists.
 */

import { timingSafeEqual } from "node:crypto";

import { expireReservations } from "~/application/commands/expire-reservations";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import type { SqlDatabase } from "~/infrastructure/db/sql";

export interface JobContext {
  db: SqlDatabase;
}

export interface JobResult {
  job: string;
  ok: boolean;
  ms: number;
  detail: Record<string, unknown> | null;
  error: string | null;
}

/**
 * The jobs this deployment knows how to run.
 *
 * A registry rather than a switch so that the endpoint, the CLI and the
 * documentation cannot disagree about what exists. Every job here must be
 * idempotent: cron delivery is at-least-once everywhere, two runs can overlap
 * when one is slow, and a job that is only correct when run exactly once is a
 * job that will one day be run twice.
 */
export const JOBS: Record<string, (context: JobContext) => Promise<Record<string, unknown>>> = {
  /**
   * Releases stock reserved by orders that were never paid.
   *
   * The one job that must not be missed. `expireReservations` claims each
   * reservation with a conditional update and re-checks payment after
   * claiming, so an overlapping run cannot release the same reservation twice
   * and cannot release stock from an order that has just been paid.
   */
  "expire-reservations": async ({ db }) => {
    const result = await expireReservations({ db, clock: systemClock, ids: cryptoIds });
    return { ...result };
  },
};

export const JOB_NAMES = Object.keys(JOBS);

/**
 * Prevents a slow run and its successor from overlapping IN THIS PROCESS.
 *
 * Not a distributed lock, and not pretending to be one: two Passenger workers
 * each have their own copy of this map. It is a cheap guard against the common
 * case — cron every five minutes and a run that takes six — and the real
 * protection against concurrent runs is that every job is idempotent. Saying
 * which of those two is doing the work matters, because a reader who believes
 * this is a lock will one day write a job that relies on it.
 */
const running = new Map<string, Promise<JobResult>>();

export async function runJob(name: string, context: JobContext): Promise<JobResult> {
  const job = JOBS[name];
  if (job === undefined) {
    return { job: name, ok: false, ms: 0, detail: null, error: `unknown job: ${name}` };
  }

  const inFlight = running.get(name);
  if (inFlight !== undefined) {
    // Awaiting the run already in progress rather than starting a second one,
    // and rather than returning "busy" — the caller asked for the job to have
    // run, and it will have when this resolves.
    return inFlight;
  }

  const started = Date.now();
  const promise = (async (): Promise<JobResult> => {
    try {
      const detail = await job(context);
      return { job: name, ok: true, ms: Date.now() - started, detail, error: null };
    } catch (error) {
      return {
        job: name,
        ok: false,
        ms: Date.now() - started,
        detail: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  running.set(name, promise);
  try {
    return await promise;
  } finally {
    running.delete(name);
  }
}

/**
 * Compares the presented secret with the configured one in constant time.
 *
 * `===` on a secret leaks its length and its matching prefix through timing.
 * That is a small leak against a long random secret and it costs one function
 * call to remove.
 */
export function secretMatches(presented: unknown, configured: string | undefined): boolean {
  if (configured === undefined || configured === "") return false;
  if (typeof presented !== "string" || presented.length === 0) return false;

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
