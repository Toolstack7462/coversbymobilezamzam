import { readFileSync, writeFileSync } from "node:fs";
import { adminMessageKey } from "../../app/lib/admin-message-key.ts";

// en.json is the editable source. The browser needs English values but already
// has the Italian UI literals in route chunks, so do not ship those keys twice.
const root = new URL("../../app/locales/admin/", import.meta.url);
const source = JSON.parse(readFileSync(new URL("en.json", root), "utf8"));
const compact = {};
const patterns = [];
const tokens = (s) =>
  [...s.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
for (const [key, value] of Object.entries(source)) {
  const id = adminMessageKey(key);
  if (Object.hasOwn(compact, id)) throw new Error(`Admin message key collision: ${key}`);
  if (!value.trim() || tokens(key) !== tokens(value))
    throw new Error(`Invalid translation: ${key}`);
  compact[id] = value;
  if (key.includes("{{v")) patterns.push(key);
}
for (const [file, value] of [
  ["en.compact.json", compact],
  ["patterns.json", patterns],
]) {
  const path = new URL(file, root);
  if (process.argv.includes("--write")) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  else if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(value))
    throw new Error(`${file} is stale. Run node scripts/verify/admin-locales.mjs --write`);
}
console.log(
  `Admin translations: ${Object.keys(source).length} messages; keys and placeholders verified.`,
);
