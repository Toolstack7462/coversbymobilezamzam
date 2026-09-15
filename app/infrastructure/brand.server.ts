import { storefrontBrand } from "~/domain/content/brand";
import { SETTING_KEYS } from "~/domain/content/gates";
import type { SqlDatabase } from "./db/sql";

/** Read only the three public identity fields, including on staff sign-in. */
export async function loadStoreBrand(db: SqlDatabase, fallback: string) {
  const rows = await db
    .prepare(`SELECT key, value FROM store_settings WHERE key IN (?1, ?2, ?3)`)
    .bind(SETTING_KEYS.brandName, SETTING_KEYS.shopName, SETTING_KEYS.brandSecondary)
    .all<{ key: string; value: string | null }>();
  const settings = Object.fromEntries(
    rows.results
      .filter((row): row is { key: string; value: string } => row.value !== null)
      .map((row) => [row.key, row.value]),
  );
  return storefrontBrand(settings, fallback);
}
