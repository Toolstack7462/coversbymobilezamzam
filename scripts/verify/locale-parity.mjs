/**
 * Locale parity gate.
 *
 * A missing key must break the BUILD, not render `undefined` to a customer.
 * Italian is the source of truth; every other locale must match its shape
 * exactly - no missing keys, and no extras that no longer exist in Italian.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "app/locales";
const SOURCE = "it.json";

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, inner]) =>
    inner !== null && typeof inner === "object"
      ? flatten(inner, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function placeholders(value) {
  return [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

function valueAt(object, path) {
  return path.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), object);
}

const source = JSON.parse(readFileSync(join(DIR, SOURCE), "utf8"));
const sourceKeys = flatten(source).sort();
const others = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== SOURCE);

let failed = false;

for (const file of others) {
  const target = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const targetKeys = flatten(target).sort();

  const missing = sourceKeys.filter((k) => !targetKeys.includes(k));
  const extra = targetKeys.filter((k) => !sourceKeys.includes(k));

  // A placeholder present in one language and absent in another renders a
  // sentence with a hole in it, which is worse than an untranslated string.
  const mismatched = sourceKeys
    .filter((k) => targetKeys.includes(k))
    .filter((k) => {
      const a = placeholders(valueAt(source, k));
      const b = placeholders(valueAt(target, k));
      return a.join(",") !== b.join(",");
    });

  if (missing.length || extra.length || mismatched.length) {
    failed = true;
    console.error(`\n${file}`);
    if (missing.length) console.error(`  missing ${missing.length}: ${missing.join(", ")}`);
    if (extra.length) console.error(`  extra ${extra.length}: ${extra.join(", ")}`);
    if (mismatched.length) console.error(`  placeholder mismatch: ${mismatched.join(", ")}`);
  } else {
    console.log(`${file}: ${targetKeys.length} keys, parity OK`);
  }
}

if (failed) {
  console.error("\nLocale parity FAILED.");
  process.exit(1);
}
console.log(`\n${SOURCE}: ${sourceKeys.length} keys. All locales in parity.`);
