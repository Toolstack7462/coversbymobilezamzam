import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  bootstrapAdmin,
  BootstrapAdminInput,
  isInstalled,
} from "~/application/commands/bootstrap-admin";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { reset } from "../fixtures/seed";

/**
 * Initial-admin bootstrap.
 *
 * The rule this file exists to prove: **exactly one administrator can ever be
 * created through the setup route**, even under a concurrent request.
 *
 * The previous guard counted staff profiles and then inserted, which two
 * simultaneous requests can both pass. These tests would have caught that.
 */

const NOW = 1_756_000_100_000;
const TOKEN = "test-setup-token-with-plenty-of-entropy-0123456789";

/** Seeds only the super_admin role, which bootstrap requires. */
async function seedRole() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO roles (id, code, name_it, name_en, is_system, sort_order, created_at, updated_at)
       VALUES ('role_super_admin','super_admin','Amministratore','Super admin',1,0,?1,?1)`,
    ).bind(NOW),
  ]);
}

let accountCounter = 0;

function deps(over: Partial<Parameters<typeof bootstrapAdmin>[1]> = {}) {
  return {
    env: { ...env, INITIAL_ADMIN_SETUP_TOKEN: TOKEN } as Env,
    clock: fixedClock(NOW),
    ids: cryptoIds,
    ipAddress: "203.0.113.10",
    createAccount: async ({ name }: { name: string; email: string; password: string }) => {
      // Stands in for Better Auth. Creating the user row directly keeps these
      // tests about the LOCK, not about password hashing.
      const userId = `user_boot_${++accountCounter}`;
      await env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?1,?2,?3,1,0,?4,?4)`,
      )
        .bind(userId, name, `${userId}@example.test`, NOW)
        .run();
      return { ok: true as const, userId, setCookie: "session=abc" };
    },
    ...over,
  } as Parameters<typeof bootstrapAdmin>[1];
}

/**
 * An Env with the key genuinely ABSENT, not set to undefined.
 *
 * With exactOptionalPropertyTypes those are different things, and "absent" is
 * what an unconfigured deploy actually looks like.
 */
function envWithoutToken(): Env {
  const base: Record<string, unknown> = { ...env };
  delete base.INITIAL_ADMIN_SETUP_TOKEN;
  return base as unknown as Env;
}

const input = (over: Record<string, unknown> = {}) =>
  BootstrapAdminInput.parse({
    name: "Prima Amministratrice",
    email: `admin${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "una-password-molto-lunga",
    setupToken: TOKEN,
    ...over,
  });

async function adminCount(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM staff_profiles WHERE archived_at IS NULL`,
  ).first<{ n: number }>();
  return row!.n;
}

describe("concurrency — the reason this was rewritten", () => {
  beforeEach(async () => {
    await reset(env.DB);
    await seedRole();
    accountCounter = 0;
  });

  it("creates EXACTLY ONE administrator when two requests arrive together", async () => {
    const [a, b] = await Promise.all([
      bootstrapAdmin(input(), deps()),
      bootstrapAdmin(input(), deps()),
    ]);

    const succeeded = [a, b].filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);

    // The one that lost must say so, not fail silently.
    const failed = [a, b].find((r) => !r.ok)!;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(["concurrent_install", "already_installed"]).toContain(failed.reason);
    }

    expect(await adminCount()).toBe(1);
  });

  it("creates exactly one administrator under five simultaneous requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => bootstrapAdmin(input(), deps())),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await adminCount()).toBe(1);
  });

  it("grants exactly one super_admin role", async () => {
    await Promise.all([bootstrapAdmin(input(), deps()), bootstrapAdmin(input(), deps())]);
    const roles = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_roles`).first<{
      n: number;
    }>();
    expect(roles!.n).toBe(1);
  });
});

describe("the setup token", () => {
  beforeEach(async () => {
    await reset(env.DB);
    await seedRole();
    accountCounter = 0;
  });

  it("rejects a wrong token and writes nothing", async () => {
    const result = await bootstrapAdmin(input({ setupToken: "wrong-token-entirely" }), deps());

    expect(result).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(await adminCount()).toBe(0);
    expect(await isInstalled(env)).toBe(false);

    // No claim was taken, so a correct attempt still works.
    const installation = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM installation_state`,
    ).first<{ n: number }>();
    expect(installation!.n).toBe(0);
  });

  it("refuses to run at all when no token is configured", async () => {
    // A bootstrap endpoint that falls back to "no token required" is a back
    // door. It must fail closed.
    const result = await bootstrapAdmin(input(), deps({ env: envWithoutToken() }));
    expect(result).toMatchObject({ ok: false, reason: "not_configured" });
    expect(await adminCount()).toBe(0);
  });

  it("refuses a token that is too short to be high-entropy", async () => {
    const result = await bootstrapAdmin(
      input({ setupToken: "short" }),
      deps({ env: { ...env, INITIAL_ADMIN_SETUP_TOKEN: "short" } as Env }),
    );
    expect(result).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("never stores the token in any form", async () => {
    await bootstrapAdmin(input(), deps());

    const attempts = await env.DB.prepare(`SELECT * FROM bootstrap_attempts`).all();
    const installation = await env.DB.prepare(`SELECT * FROM installation_state`).all();
    const audit = await env.DB.prepare(`SELECT * FROM audit_logs`).all();

    const dumped = JSON.stringify([attempts.results, installation.results, audit.results]);
    expect(dumped).not.toContain(TOKEN);
    // Only the FACT that a token was consumed is recorded.
    expect(dumped).toContain("setupTokenConsumed");
  });
});

describe("replay and closure", () => {
  beforeEach(async () => {
    await reset(env.DB);
    await seedRole();
    accountCounter = 0;
  });

  it("refuses a second installation with the same valid token", async () => {
    const first = await bootstrapAdmin(input(), deps());
    expect(first.ok).toBe(true);

    const replay = await bootstrapAdmin(input(), deps());
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(["already_installed", "concurrent_install"]).toContain(replay.reason);
    }
    expect(await adminCount()).toBe(1);
  });

  it("reports installed, so the route can 404", async () => {
    expect(await isInstalled(env)).toBe(false);
    await bootstrapAdmin(input(), deps());
    expect(await isInstalled(env)).toBe(true);
  });

  it("records completion with the user who did it", async () => {
    const result = await bootstrapAdmin(input(), deps());
    if (!result.ok) throw new Error("expected success");

    const state = await env.DB.prepare(
      `SELECT status, completed_by_user_id, completed_at, token_consumed_at
         FROM installation_state WHERE id = 'singleton'`,
    ).first<{
      status: string;
      completed_by_user_id: string;
      completed_at: number;
      token_consumed_at: number;
    }>();

    expect(state!.status).toBe("completed");
    expect(state!.completed_by_user_id).toBe(result.userId);
    expect(state!.completed_at).toBe(NOW);
    expect(state!.token_consumed_at).toBe(NOW);
  });
});

describe("failure and recovery", () => {
  beforeEach(async () => {
    await reset(env.DB);
    await seedRole();
    accountCounter = 0;
  });

  it("releases the claim when account creation fails, so a retry works", async () => {
    const failing = await bootstrapAdmin(
      input(),
      deps({
        createAccount: async () => ({ ok: false as const, detail: "email_taken" }),
      }),
    );
    expect(failing).toMatchObject({ ok: false, reason: "account_creation_failed" });

    // Claim released: nothing was created, so holding the lock would strand the
    // whole installation.
    const state = await env.DB.prepare(`SELECT COUNT(*) AS n FROM installation_state`).first<{
      n: number;
    }>();
    expect(state!.n).toBe(0);

    const retry = await bootstrapAdmin(input(), deps());
    expect(retry.ok).toBe(true);
    expect(await adminCount()).toBe(1);
  });

  it("does not leave a half-installed system when the staff batch fails", async () => {
    // No super_admin role: the batch cannot complete.
    await env.DB.prepare(`DELETE FROM roles`).run();

    const result = await bootstrapAdmin(input(), deps());
    expect(result).toMatchObject({ ok: false, reason: "roles_missing" });

    expect(await adminCount()).toBe(0);
    expect(await isInstalled(env)).toBe(false);
  });

  it("reclaims a STALE in-progress claim, but not a live one", async () => {
    // A Worker can die mid-install and strand the lock forever.
    await env.DB.prepare(
      `INSERT INTO installation_state (id, status, claimed_at) VALUES ('singleton','in_progress',?1)`,
    )
      .bind(NOW - 20 * 60 * 1000)
      .run();

    const stale = await bootstrapAdmin(input(), deps());
    expect(stale.ok).toBe(true);
    expect(await adminCount()).toBe(1);
  });

  it("does NOT reclaim a claim that is still live", async () => {
    await env.DB.prepare(
      `INSERT INTO installation_state (id, status, claimed_at) VALUES ('singleton','in_progress',?1)`,
    )
      .bind(NOW - 60 * 1000)
      .run();

    const result = await bootstrapAdmin(input(), deps());
    expect(result).toMatchObject({ ok: false, reason: "concurrent_install" });
    expect(await adminCount()).toBe(0);
  });
});

describe("rate limiting", () => {
  beforeEach(async () => {
    await reset(env.DB);
    await seedRole();
    accountCounter = 0;
  });

  it("locks out after repeated wrong tokens from the same source", async () => {
    for (let i = 0; i < 5; i++) {
      const attempt = await bootstrapAdmin(input({ setupToken: `guess-${i}` }), deps());
      expect(attempt).toMatchObject({ ok: false, reason: "invalid_token" });
    }

    const blocked = await bootstrapAdmin(input({ setupToken: "guess-5" }), deps());
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });

    // Even the CORRECT token is refused while the lockout stands, which is the
    // point: guessing must not be cheap.
    const correct = await bootstrapAdmin(input(), deps());
    expect(correct).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await adminCount()).toBe(0);
  });

  it("stores the source hashed, never in the clear", async () => {
    await bootstrapAdmin(input({ setupToken: "wrong" }), deps());
    const row = await env.DB.prepare(`SELECT ip_hash FROM bootstrap_attempts LIMIT 1`).first<{
      ip_hash: string;
    }>();

    expect(row!.ip_hash).not.toBe("203.0.113.10");
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
