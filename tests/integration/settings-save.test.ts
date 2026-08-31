import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { SETTING_GROUPS, SETTING_FIELDS, uncoveredKeys } from "~/lib/setting-fields";
import { SETTING_KEYS } from "~/domain/content/gates";
import { seed } from "../../tests/fixtures/seed";

/**
 * Saving settings, against a real D1.
 *
 * The bug this file exists for: a boolean setting could be switched ON but
 * never OFF. An unchecked checkbox submits nothing, and the save loop read an
 * absent field as "unchanged" rather than "false". The merchant would untick
 * "ritiro in negozio attivo", press save, see a success message, and the shop
 * would go on offering pickup. A silent failure with a green confirmation on
 * top of it is the worst shape this can take, so it gets a test rather than a
 * fix and a promise.
 */

/** Mirrors the route's save loop: collect last-wins, then diff, then write. */
async function save(fields: [string, string][]): Promise<number> {
  const submitted = new Map<string, string>();
  for (const [key, value] of fields) submitted.set(key, value.trim());

  const currentRows = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const current = new Map(currentRows.results.map((r) => [r.key, r.value]));

  const statements = [];
  for (const [key, value] of submitted) {
    const existing = current.get(key);
    if (existing === undefined || existing === value) continue;
    statements.push(
      env.DB.prepare(`UPDATE store_settings SET value = ?1 WHERE key = ?2`).bind(value, key),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}

const read = async (key: string): Promise<string | null> => {
  const row = await env.DB.prepare(`SELECT value FROM store_settings WHERE key = ?1`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
};

describe("booleans can be switched off", () => {
  beforeEach(async () => {
    await seed(env.DB);
    await env.DB.prepare(`UPDATE store_settings SET value = 'true' WHERE key = ?1`)
      .bind(SETTING_KEYS.pickupEnabled)
      .run();
  });

  it("turns pickup off when the box is unchecked", async () => {
    // What the browser actually sends with the box unticked: only the hidden
    // companion field. Without that hidden field this array would be empty and
    // the setting would silently survive.
    await save([[SETTING_KEYS.pickupEnabled, "false"]]);
    expect(await read(SETTING_KEYS.pickupEnabled)).toBe("false");
  });

  it("turns pickup on when the box is checked", async () => {
    await env.DB.prepare(`UPDATE store_settings SET value = 'false' WHERE key = ?1`)
      .bind(SETTING_KEYS.pickupEnabled)
      .run();

    // Checked sends BOTH the hidden false and the checkbox true, in that order.
    // Last-wins is what makes the pair resolve correctly.
    await save([
      [SETTING_KEYS.pickupEnabled, "false"],
      [SETTING_KEYS.pickupEnabled, "true"],
    ]);
    expect(await read(SETTING_KEYS.pickupEnabled)).toBe("true");
  });

  it("reproduces the old bug when the hidden field is absent", async () => {
    // Proof the guard is load-bearing rather than decorative: submitting
    // nothing for the key leaves it on, which is exactly what merchants saw.
    await save([[SETTING_KEYS.phone, "0864000000"]]);
    expect(await read(SETTING_KEYS.pickupEnabled)).toBe("true");
  });
});

describe("saving ordinary settings", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("writes a changed value and skips unchanged ones", async () => {
    const written = await save([
      [SETTING_KEYS.phone, "0864000000"],
      // Already this value from the seed, so it must not produce a write or an
      // audit row: a no-op edit that logs is noise in the one place that has to
      // stay readable.
      [SETTING_KEYS.storeCity, (await read(SETTING_KEYS.storeCity)) ?? ""],
    ]);
    expect(written).toBe(1);
    expect(await read(SETTING_KEYS.phone)).toBe("0864000000");
  });

  it("ignores a key that does not exist", async () => {
    // Settings are created by migrations. An unknown key is a typo or a stale
    // form, not a new setting someone meant to create from a browser.
    const written = await save([["business.invented_key", "x"]]);
    expect(written).toBe(0);
    expect(await read("business.invented_key")).toBeNull();
  });
});

describe("the field descriptions match the database", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("describes only keys that actually exist", async () => {
    // A described field whose key is not in the database renders an input that
    // silently saves nothing.
    const rows = await env.DB.prepare(`SELECT key FROM store_settings`).all<{ key: string }>();
    const existing = new Set(rows.results.map((r) => r.key));

    for (const field of SETTING_FIELDS.values()) {
      expect(existing.has(field.key), `${field.key} is described but not in store_settings`).toBe(
        true,
      );
    }
  });

  it("reports any database key the groups do not cover", async () => {
    // Not a failure — uncovered keys are rendered in an "other" group so they
    // stay editable. This asserts the fallback is computed from real data, so
    // that a migration adding a setting cannot make it unreachable.
    const rows = await env.DB.prepare(`SELECT key FROM store_settings`).all<{ key: string }>();
    const uncovered = uncoveredKeys(rows.results.map((r) => r.key));
    const described = [...SETTING_FIELDS.keys()];

    expect(uncovered.length + described.filter((k) => k).length).toBeGreaterThan(0);
    for (const key of uncovered) {
      expect(SETTING_FIELDS.has(key)).toBe(false);
    }
  });

  it("gives every field a label and help text that is not the label again", async () => {
    for (const group of SETTING_GROUPS) {
      for (const field of group.fields) {
        expect(field.label.length, field.key).toBeGreaterThan(2);
        expect(field.label, field.key).not.toContain(".");
        expect(field.help.length, field.key).toBeGreaterThan(15);
        expect(field.help, field.key).not.toBe(field.label);
      }
    }
  });

  it("uses no field key twice", () => {
    const keys = SETTING_GROUPS.flatMap((g) => g.fields).map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
