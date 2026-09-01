/**
 * Placeholder artwork for the demo catalogue.
 *
 * ORIGINAL line illustrations, not photographs, and never presented as such:
 * the alt text says so in both languages, in every locale the shop serves. They
 * exist so the grid can be judged at realistic density
 * — a shop with four grey rectangles cannot be reviewed — and they are replaced
 * the moment the merchant supplies their own product shots.
 *
 * Drawn in the same visual language as the merchant's Shopify storefront so the
 * two properties read as one shop: 64-unit grid, 1.6 stroke, round caps, no
 * fill.
 */

/** Each entry is the inner markup of a 64×64 viewBox. */
export const ARTWORK = {
  case: {
    it: "Illustrazione segnaposto: cover per smartphone",
    en: "Placeholder illustration: phone case",
    paths: `
      <rect x="17" y="7" width="30" height="50" rx="7"/>
      <rect x="21" y="11" width="22" height="42" rx="4"/>
      <circle cx="27" cy="19" r="3"/><circle cx="35" cy="19" r="3"/>
      <circle cx="27" cy="27" r="3"/>
      <path d="M15 23v4M15 31v6M49 26v7"/>`,
  },
  charger: {
    it: "Illustrazione segnaposto: caricatore da rete",
    en: "Placeholder illustration: mains charger",
    paths: `
      <rect x="15" y="17" width="34" height="30" rx="7"/>
      <path d="M26 17v-6M38 17v-6"/>
      <rect x="22" y="38" width="6" height="4" rx="1.5"/>
      <rect x="30" y="38" width="6" height="4" rx="1.5"/>
      <rect x="38" y="38" width="6" height="4" rx="1.5"/>
      <path d="M25 26h14"/>`,
  },
  cable: {
    it: "Illustrazione segnaposto: cavo di ricarica",
    en: "Placeholder illustration: charging cable",
    paths: `
      <rect x="7" y="11" width="8" height="9" rx="2.5"/>
      <rect x="49" y="44" width="8" height="9" rx="2.5"/>
      <path d="M15 15.5h5a5 5 0 0 1 5 5v9a9 9 0 0 0 9 9h6a9 9 0 0 1 9 9v1.5"/>
      <path d="M11 11V8M53 53v3"/>`,
  },
  powerbank: {
    it: "Illustrazione segnaposto: power bank",
    en: "Placeholder illustration: power bank",
    paths: `
      <rect x="17" y="10" width="30" height="44" rx="6"/>
      <rect x="23" y="18" width="18" height="7" rx="2"/>
      <path d="M23 33h12M23 39h16"/>
      <circle cx="40" cy="45" r="3.5"/>`,
  },
  screen_protector: {
    it: "Illustrazione segnaposto: pellicola protettiva",
    en: "Placeholder illustration: screen protector",
    paths: `
      <rect x="17" y="7" width="30" height="50" rx="7"/>
      <path d="M27 13h10"/>
      <path d="M23 21h18v26a2 2 0 0 1-2 2H31l-8-8z"/>
      <path d="M31 49v-6a2 2 0 0 0-2-2h-6"/>`,
  },
  magsafe: {
    it: "Illustrazione segnaposto: accessorio magnetico",
    en: "Placeholder illustration: magnetic accessory",
    paths: `
      <rect x="8" y="13" width="25" height="38" rx="6"/>
      <circle cx="43" cy="32" r="12"/>
      <circle cx="43" cy="32" r="6"/>
      <path d="M55 32h4"/>`,
  },
  audio: {
    it: "Illustrazione segnaposto: cuffie",
    en: "Placeholder illustration: headphones",
    paths: `
      <path d="M14 37v-6a18 18 0 0 1 36 0v6"/>
      <rect x="9" y="34" width="10" height="17" rx="4"/>
      <rect x="45" y="34" width="10" height="17" rx="4"/>`,
  },
  car_mount: {
    it: "Illustrazione segnaposto: supporto da auto",
    en: "Placeholder illustration: car mount",
    paths: `
      <rect x="21" y="8" width="22" height="32" rx="4"/>
      <path d="M17 15v9a2 2 0 0 0 2 2h2"/>
      <path d="M47 15v9a2 2 0 0 1-2 2h-2"/>
      <path d="M32 40v8"/>
      <rect x="21" y="48" width="22" height="6" rx="3"/>`,
  },
};

/**
 * Two views per product.
 *
 * `full` is the object; `detail` is the same drawing enlarged and cropped, the
 * way a second photograph would show the part that justifies the price.
 *
 * It is a real second view rather than a duplicate, and it is still plainly an
 * illustration — which is the point. A gallery with one image cannot be judged,
 * and inventing a second *photograph* would be a lie. Enlarging a drawing is
 * not.
 */
export const VIEWS = {
  full: { scale: 0.8, translate: 6.4, suffix: "", labelIt: "", labelEn: "" },
  detail: {
    scale: 1.9,
    translate: -30,
    suffix: "-detail",
    labelIt: " — vista di dettaglio",
    labelEn: " — detail view",
  },
};

/** A complete SVG document for one illustration, on the shop's surface colour. */
export function svgFor(
  key,
  { size = 1000, ink = "#667085", surface = "#f4f5f2", view = "full" } = {},
) {
  const art = ARTWORK[key];
  if (!art) throw new Error(`No artwork for "${key}"`);
  const v = VIEWS[view];
  if (!v) throw new Error(`No view "${view}"`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${surface}"/>
  <g fill="none" stroke="${ink}" stroke-width="${(1.4 / v.scale).toFixed(2)}"
     stroke-linecap="round" stroke-linejoin="round" opacity="0.75"
     transform="translate(${v.translate} ${v.translate}) scale(${v.scale})">${art.paths}
  </g>
</svg>`;
}
