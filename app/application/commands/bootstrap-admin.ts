import { z } from "zod";
import type { Clock, IdGenerator } from "~/application/ports";

/**
 * Initial administrator bootstrap.
 *
 * The previous guard was "run only while zero staff profiles exist" — a READ
 * followed by a WRITE. Two simultaneous requests can both read zero and both
 * proceed, producing two administrators from a route meant to produce one.
 *
 * This version claims an atomic singleton lock BEFORE creating anything, so the
 * loser of a race never reaches account creation at all.
 *
 * Order of operations, and why:
 *
 *   1. Rate-limit check      — cheapest, and it protects the token from being
 *                              brute-forced.
 *   2. Token check           — constant-time, before any write.
 *   3. ATOMIC CLAIM          — the PRIMARY KEY is the lock.
 *   4. Create the account    — through Better Auth's own path.
 *   5. Create staff + role   — in one batch with the completion marker.
 *   6. On any failure        — release the claim so a retry is possible.
 */

export const BootstrapAdminInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  // These accounts can change where money goes.
  password: z.string().min(12).max(200),
  setupToken: z.string().min(1).max(500),
});

export type BootstrapAdminInput = z.infer<typeof BootstrapAdminInput>;

export type BootstrapAdminResult =
  | { ok: true; userId: string; setCookie: string | null }
  | { ok: false; reason: "already_installed" }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "roles_missing" }
  | { ok: false; reason: "concurrent_install" }
  | { ok: false; reason: "account_creation_failed"; detail: string };

export interface BootstrapAdminDeps {
  env: Env;
  clock: Clock;
  ids: IdGenerator;
  ipAddress: string | null;
  /**
   * Injected rather than imported so this use case stays testable without
   * standing up Better Auth's HTTP surface.
   */
  createAccount: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<
    { ok: true; userId: string; setCookie: string | null } | { ok: false; detail: string }
  >;
}

/** A stale claim is reclaimable: a Worker can die mid-install. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_FAILURES = 5;

/**
 * Constant-time string comparison.
 *
 * `a === b` short-circuits on the first differing byte, which leaks the length
 * of the correct prefix to anyone timing the response. workerd has no
 * `crypto.timingSafeEqual`, so this compares every byte regardless.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  // Length itself is compared without an early return.
  let mismatch = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}

/** Rate limiting needs to recognise a repeat visitor, not identify them. */
async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function recordAttempt(
  deps: BootstrapAdminDeps,
  outcome: string,
  ipHash: string | null,
): Promise<void> {
  await deps.env.DB.prepare(
    `INSERT INTO bootstrap_attempts (id, ip_hash, outcome, attempted_at) VALUES (?1,?2,?3,?4)`,
  )
    .bind(deps.ids.generate(), ipHash, outcome, deps.clock.now())
    .run();
}

/** Whether installation has already completed. Safe to call unauthenticated. */
export async function isInstalled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT status FROM installation_state WHERE id = 'singleton'`,
  ).first<{ status: string }>();
  return row?.status === "completed";
}

export async function bootstrapAdmin(
  input: BootstrapAdminInput,
  deps: BootstrapAdminDeps,
): Promise<BootstrapAdminResult> {
  const { env, clock, ids } = deps;
  const now = clock.now();

  const expected = env.INITIAL_ADMIN_SETUP_TOKEN;
  const ipHash = deps.ipAddress ? await hashIp(deps.ipAddress, env.BETTER_AUTH_SECRET) : null;

  // Without a configured token the route is unusable rather than open. A
  // bootstrap endpoint that falls back to "no token required" is a back door.
  if (!expected || expected.trim().length < 24) {
    await recordAttempt(deps, "not_configured", ipHash);
    return { ok: false, reason: "not_configured" };
  }

  // ── 1. Rate limit ────────────────────────────────────────────────────────
  if (ipHash) {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM bootstrap_attempts
        WHERE ip_hash = ?1 AND attempted_at > ?2 AND outcome IN ('invalid_token','rate_limited')`,
    )
      .bind(ipHash, now - RATE_LIMIT_WINDOW_MS)
      .first<{ n: number }>();

    if ((recent?.n ?? 0) >= RATE_LIMIT_MAX_FAILURES) {
      await recordAttempt(deps, "rate_limited", ipHash);
      return { ok: false, reason: "rate_limited" };
    }
  }

  // ── 2. Token, constant-time, before any write ────────────────────────────
  if (!timingSafeEqual(input.setupToken, expected)) {
    await recordAttempt(deps, "invalid_token", ipHash);
    return { ok: false, reason: "invalid_token" };
  }

  // Cheap pre-check for a clear message. NOT the guard - step 3 is the guard.
  if (await isInstalled(env)) {
    await recordAttempt(deps, "already_installed", ipHash);
    return { ok: false, reason: "already_installed" };
  }

  const role = await env.DB.prepare(`SELECT id FROM roles WHERE code = 'super_admin'`).first<{
    id: string;
  }>();
  if (!role) return { ok: false, reason: "roles_missing" };

  /**
   * ── 3. THE ATOMIC CLAIM ─────────────────────────────────────────────────
   *
   * One statement that either claims fresh, reclaims a stale in-progress
   * attempt, or affects nothing. `id` is CHECK-constrained to 'singleton', so
   * the PRIMARY KEY is the mutex.
   *
   * The `WHERE` on the conflict branch is what makes a stale reclaim safe: a
   * live in-progress claim is younger than STALE_CLAIM_MS and will not match,
   * and a completed install will not match either.
   */
  const claim = await env.DB.prepare(
    `INSERT INTO installation_state (id, status, claimed_at, token_consumed_at)
     VALUES ('singleton', 'in_progress', ?1, ?1)
     ON CONFLICT(id) DO UPDATE
       SET claimed_at = ?1, token_consumed_at = ?1
     WHERE installation_state.status = 'in_progress'
       AND installation_state.claimed_at < ?2`,
  )
    .bind(now, now - STALE_CLAIM_MS)
    .run();

  if (claim.meta.changes === 0) {
    // Someone else holds a live claim, or installation already completed.
    await recordAttempt(deps, "already_installed", ipHash);
    return { ok: false, reason: "concurrent_install" };
  }

  await recordAttempt(deps, "claimed", ipHash);

  // ── 4. Account, through Better Auth's own path ───────────────────────────
  // No second password-hashing implementation exists in this project.
  const account = await deps.createAccount({
    name: input.name,
    email: input.email,
    password: input.password,
  });

  if (!account.ok) {
    // Release the claim so the merchant can correct the input and retry. This
    // is the "failed before account creation" recovery path: releasing is safe
    // because no user, staff profile or role grant exists yet.
    await env.DB.prepare(`DELETE FROM installation_state WHERE id = 'singleton'`).run();
    await recordAttempt(deps, "failed", ipHash);
    return { ok: false, reason: "account_creation_failed", detail: account.detail };
  }

  // ── 5. Staff profile, role grant and completion, in ONE batch ────────────
  // Either all of it lands or none of it does: a user with no staff profile, or
  // a staff profile with no role, would be a half-installed system that looks
  // finished.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO staff_profiles (id, user_id, display_name, job_title, active, created_at, updated_at)
         VALUES (?1,?2,?3,'Amministratore',1,?4,?4)`,
      ).bind(ids.generate(), account.userId, input.name, now),

      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, granted_by, granted_at)
         VALUES (?1,?2,?3,?2,?4)`,
      ).bind(ids.generate(), account.userId, role.id, now),

      env.DB.prepare(
        `UPDATE installation_state
            SET status = 'completed', completed_at = ?1, completed_by_user_id = ?2
          WHERE id = 'singleton' AND status = 'in_progress'`,
      ).bind(now, account.userId),

      // Audited WITHOUT the token, in any form.
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'staff.bootstrap','user',?2,?4,?5)`,
      ).bind(
        ids.generate(),
        account.userId,
        input.name,
        JSON.stringify({
          role: "super_admin",
          viaFirstRunSetup: true,
          setupTokenConsumed: true,
        }),
        now,
      ),
    ]);
  } catch (error) {
    // The account now exists but is not staff. Leave the claim in place: it is
    // 'in_progress' and will become reclaimable after STALE_CLAIM_MS, and the
    // orphaned user holds no privileges at all.
    await recordAttempt(deps, "failed", ipHash);
    return {
      ok: false,
      reason: "account_creation_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  await recordAttempt(deps, "completed", ipHash);
  return { ok: true, userId: account.userId, setCookie: account.setCookie };
}
