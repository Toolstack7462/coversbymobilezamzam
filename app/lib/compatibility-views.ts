import type { ListView } from "~/lib/order-views";
import type { CompatibilityLevel } from "~/domain/compatibility/resolve";

/**
 * Saved views and labels for the compatibility matrix.
 *
 * `non-verificate` is the action centre's and the setup centre's target, so the
 * slug is a contract checked by `tests/unit/deep-links.test.ts`.
 */
export const COMPATIBILITY_VIEWS: readonly ListView[] = [
  {
    slug: "non-verificate",
    label: "Da verificare",
    // Only exact_fit matters here. A "compatible" claim is a judgement about
    // fit in general; "exact_fit" is a promise about one specific phone, and
    // it is the one that produces a return when it is wrong.
    where: "pc.compatibility_level = 'exact_fit' AND pc.verified = 0",
  },
  { slug: "tutte", label: "Tutte", where: "1 = 1" },
  { slug: "verificate", label: "Verificate", where: "pc.verified = 1" },
  {
    slug: "esatte",
    label: "Compatibilità esatta",
    where: "pc.compatibility_level = 'exact_fit'",
  },
  {
    slug: "universali",
    label: "Universali",
    where: "pc.compatibility_level = 'universal'",
  },
  {
    slug: "incompatibili",
    label: "Dichiarate incompatibili",
    // Recorded incompatibility is useful data, not an error: it lets the
    // storefront say "this does not fit your phone" instead of staying silent.
    where: "pc.compatibility_level = 'incompatible'",
  },
];

export const COMPATIBILITY_VIEW_SLUGS = COMPATIBILITY_VIEWS.map((v) => v.slug);

/**
 * Italian labels, exhaustive by type so a new level in the domain fails the
 * build until someone has named it.
 */
export const COMPATIBILITY_LABELS: Record<CompatibilityLevel, string> = {
  exact_fit: "Compatibilità esatta",
  compatible: "Compatibile",
  universal: "Universale",
  adapter_required: "Serve un adattatore",
  incompatible: "Non compatibile",
  unverified: "Non verificata",
};

/**
 * What each level actually promises a customer.
 *
 * Written out because the difference between them is the difference between a
 * sale and a return, and the person recording it is doing so from memory at the
 * counter.
 */
export const COMPATIBILITY_MEANING: Record<CompatibilityLevel, string> = {
  exact_fit:
    "Progettato per questo modello preciso: fori, tasti e fotocamera coincidono. È la dichiarazione più forte e va verificata su un telefono vero.",
  compatible: "Funziona con questo modello, senza essere pensato apposta per lui.",
  universal: "Va bene per molti telefoni. Non diventa mai “compatibilità esatta”.",
  adapter_required: "Funziona solo con un adattatore, che il cliente deve avere o comprare.",
  incompatible: "Non funziona con questo modello. Registrarlo evita un reso.",
  unverified: "Nessuno l'ha ancora controllato.",
};

export function compatibilityTone(level: string, verified: boolean): string {
  if (level === "incompatible") return "badge--sale";
  if (level === "exact_fit") return verified ? "badge--success" : "badge--warning";
  if (level === "unverified") return "badge--warning";
  return "badge--info";
}
