/** Known stock-photo assignments from the checked-in provenance audit.
 * Quarantine keys, not product IDs: a new merchant upload works immediately.
 * This is a defect denylist, not a substitute for the CMS or merchant review.
 */
const unsuitableProductKeys = new Set([
  "products/FQXbLmlmvWY-3e502e5165.webp",
  "products/SLRY3AP9g0Y-791f675793.webp",
  "products/erTPOr4SDmk-435e8ca8f0.webp",
  "products/GucoomUEQkA-1201235993.webp",
  "products/Z1XDmnXriTE-dcf8188bef.webp",
  "products/2SKjzvJfbKI-29215ab764.webp",
  "products/PKdPVv-Eb2w-8796fa82a3.webp",
  "products/tYK_iGMdgwY-606231802e.webp",
  "products/mR3UqBUU9Ts-ed22cf12a1.webp",
  "products/bSviTKDAV8o-15d2c46569.webp",
  "products/ut67iFuoD2o-8aee04c3c2.webp",
  "products/NxnJX6YLDVk-0ef172e88d.webp",
  "products/59E1OFivRhE-74e27b45ed.webp",
  "products/E7EdaTTM7w8-5c8bbc4866.webp",
  "products/APHlCkuUXfU-15659c3681.webp",
  "products/0tJKRYEdFhc-43a00a7620.webp",
  "products/CY4mVpRvPxc-ce7586327a.webp",
  "products/KI7M3RQezJI-a43a963a5f.webp",
  "products/ybTKLtBQ7NQ-ccb45aff5d.webp",
  "products/xIcr9ygfhIk-d0415c3fc1.webp",
  "products/UmlxLLbm9a4-ddf0380535.webp",
  "products/z9NgXD6JLZs-a6060ea120.webp",
  "products/GS-imDgsKAQ-9041b43042.webp",
  "products/B9XOTzqICkY-9ee6e401b9.webp",
  "products/pIFMaARy1yk-56bf5d2397.webp",
  "products/cwHNgptHPxo-6e873bfa22.webp",
]);
export function saleableImageKey(key: string | null | undefined): string | null {
  if (!key || unsuitableProductKeys.has(key) || key.startsWith("demo/")) return null;
  return key;
}
export function editorialHeroKey(key: string | null): string | null {
  return key === "lifestyle/4lrS2PuN_2g-91057cb6bb.webp" ? null : key;
}
export function storePhotoKey(key: string | null): string | null {
  return key === "lifestyle/WEer-k_jhE4-1b79f37377.webp" ? null : key;
}

/** Fixed SQL over the internal pi alias. No request or merchant text becomes SQL. */
export function saleableImagePredicate(): string {
  const keys = [...unsuitableProductKeys].map((key) => `'${key.replaceAll("'", "''")}'`).join(",");
  return `pi.object_key <> '' AND substr(pi.object_key, 1, 5) <> 'demo/' AND pi.object_key NOT IN (${keys})`;
}
