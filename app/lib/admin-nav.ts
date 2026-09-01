import type { Permission } from "~/domain/users/permissions";

/**
 * The admin navigation model.
 *
 * Two rules, both enforced on the SERVER:
 *
 *   1. A section the merchant cannot use is not shown — absent, not greyed out.
 *      Every disabled sidebar item is a small daily lie about what the software
 *      does, and eight of them teach people to stop reading the sidebar.
 *
 *   2. Hiding a link is NEVER the access control. Every route calls
 *      `requireStaff` with its own permission; this tree only decides what is
 *      worth offering. The browser is never sent the names of routes the user
 *      cannot open.
 */

export interface NavItem {
  label: string;
  to: string;
  /** Null means "any authenticated staff member". */
  permission: Permission | null;
  /** Matches only the exact path, for section roots like `/admin`. */
  end?: boolean;
  /**
   * Modules still being built are hidden rather than shown broken. Removing the
   * flag is the last step of shipping one.
   */
  flag?: AdminFeature;
  /** Shown as a count badge when the loader supplies one. */
  badgeKey?: "paymentsToVerify" | "pickupsToPrepare" | "lowStock";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Feature flags for modules under construction.
 *
 * Flipping one to `true` reveals its nav entries. They are listed explicitly so
 * that "what is not finished yet" is a single readable list rather than
 * scattered through the tree.
 */
export const ADMIN_FEATURES = {
  /*
   * Order fulfilment: pickups, shipments, returns.
   *
   * Shipped. Each screen is a writer as well as a reader — a pickup is opened,
   * marked ready and marked collected here; a shipment is recorded here; a
   * return is opened and progressed here — so none of them depends on a
   * checkout step that does not exist yet.
   *
   * They are empty until orders exist, and both `shipping.enabled` and
   * `pickup.enabled` are currently off, which each screen says on its own face
   * rather than looking broken.
   */
  fulfilment: true,

  // Shipped. The flags stay so the shape of "what is not built" is still one
  // readable list rather than an absence.
  inventoryDetail: true,
  promotions: true,
  content: true,
  customers: true,
  importExport: true,

  // Shipped: a schema, a moderation queue, and public display with the
  // provenance of every review stated on it.
  reviews: true,

  /*
   * Retired, not pending.
   *
   * catalogueAdmin covered a "product families" screen, and `reviews` a review
   * moderation queue. Neither is coming:
   *
   *   - product_families has no reader and no writer anywhere, and the job
   *     people expect it to do — "does this fit my phone?" — is already done
   *     properly by product_compatibility.
   *   - there is no reviews table at all. A moderation screen would have needed
   *     a schema, a collection flow and a policy on who may write one; a nav
   *     entry promising it was the cheapest part by a wide margin.
   *
   * Both are kept here as `false` rather than deleted so that a future reader
   * finds the decision instead of wondering whether they were forgotten.
   */
  // Shipped: families group the same item cut for different phones, and the
  // product page reads them.
  catalogueAdmin: true,
} as const;

export type AdminFeature = keyof typeof ADMIN_FEATURES;

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Panoramica",
    items: [
      { label: "Panoramica", to: "/admin", permission: null, end: true },
      { label: "Centro configurazione", to: "/admin/configurazione", permission: null },
      { label: "Attività", to: "/admin/registro", permission: "audit.read" },
    ],
  },
  {
    label: "Vendite",
    items: [
      { label: "Ordini", to: "/admin/ordini", permission: "order.read" },
      {
        label: "Pagamenti da verificare",
        to: "/admin/pagamenti",
        permission: "payment.read",
        badgeKey: "paymentsToVerify",
      },
      {
        label: "Ritiri in negozio",
        to: "/admin/ritiri",
        permission: "order.read",
        badgeKey: "pickupsToPrepare",
      },
      {
        label: "Spedizioni",
        to: "/admin/spedizioni",
        permission: "order.read",
      },
      { label: "Resi", to: "/admin/resi", permission: "order.read" },
      // No flag: built. Derived from orders rather than a separate table.
      { label: "Clienti", to: "/admin/clienti", permission: "customer.read" },
    ],
  },
  {
    label: "Catalogo",
    items: [
      { label: "Prodotti", to: "/admin/prodotti", permission: "product.read" },
      // Brands and categories share one screen: they are the same kind of
      // thing, and a merchant sets both up in one sitting.
      { label: "Marchi e categorie", to: "/admin/marchi", permission: "product.read" },
      // No flag: built. Compatibility depends on it, so it is the one catalogue
      // screen that had to come first.
      { label: "Dispositivi", to: "/admin/dispositivi", permission: "product.read" },
      { label: "Famiglie prodotto", to: "/admin/famiglie", permission: "product.read" },
      { label: "Compatibilità", to: "/admin/compatibilita", permission: "product.read" },
    ],
  },
  {
    label: "Inventario",
    items: [
      {
        label: "Panoramica scorte",
        to: "/admin/inventario",
        permission: "inventory.read",
        end: true,
        badgeKey: "lowStock",
      },
      {
        label: "Movimenti",
        to: "/admin/inventario/movimenti",
        permission: "inventory.read",
      },
      {
        label: "Rettifiche",
        to: "/admin/inventario/rettifiche",
        permission: "inventory.read",
      },
      {
        label: "Trasferimenti",
        to: "/admin/inventario/trasferimenti",
        permission: "inventory.transfer",
      },
      {
        label: "Scorte basse",
        to: "/admin/inventario/scorte-basse",
        permission: "inventory.read",
      },
      {
        label: "Prenotazioni",
        to: "/admin/inventario/prenotazioni",
        permission: "inventory.read",
      },
    ],
  },
  {
    label: "Promozione",
    items: [
      // No flag: built. Order-level coupons only — product price reductions
      // go through the product editor, where price_history is written.
      { label: "Sconti", to: "/admin/sconti", permission: "price.read" },
      { label: "Recensioni", to: "/admin/recensioni", permission: "content.read" },
      {
        label: "Promozioni",
        to: "/admin/promozioni",
        permission: "price.write",
      },
      {
        label: "Prodotti in evidenza",
        to: "/admin/in-evidenza",
        permission: "product.write",
      },
    ],
  },
  {
    label: "Contenuti",
    items: [
      {
        label: "Homepage",
        to: "/admin/contenuti/homepage",
        permission: "content.write",
      },
      { label: "Menu e navigazione", to: "/admin/contenuti/menu", permission: "content.read" },
      { label: "Pagine", to: "/admin/contenuti/pagine", permission: "content.read" },
      // Guides ARE pages. Same table, same editor — this is a filtered view of it,
      // because two screens writing one table is how they end up disagreeing.
      {
        label: "Guide",
        to: "/admin/contenuti/pagine?tipo=guide",
        permission: "content.read",
      },
      { label: "Documenti legali", to: "/admin/contenuti/legale", permission: "content.read" },
      { label: "SEO", to: "/admin/contenuti/seo", permission: "content.read" },
    ],
  },
  {
    label: "Impostazioni",
    items: [
      { label: "Impostazioni", to: "/admin/impostazioni", permission: "settings.read", end: true },
      { label: "Personale e ruoli", to: "/admin/personale", permission: "staff.read" },
      { label: "Sicurezza", to: "/admin/sicurezza", permission: null },
      // No flag: built. Export needs only product.read, so the nav shows it to
      // anyone who can see the catalogue; the import half checks import.run.
      { label: "Importa ed esporta", to: "/admin/importazioni", permission: "product.read" },
      { label: "Stato del sistema", to: "/admin/sistema", permission: "settings.read" },
    ],
  },
];

/**
 * Filters the tree for one actor. Call this on the SERVER.
 *
 * A group with no visible items disappears entirely — an empty heading is worse
 * than no heading.
 */
export function visibleNav(
  permissions: readonly string[],
  features: Readonly<Record<AdminFeature, boolean>> = ADMIN_FEATURES,
): NavGroup[] {
  return ADMIN_NAV.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => {
      if (item.flag && !features[item.flag]) return false;
      return item.permission === null || permissions.includes(item.permission);
    }),
  })).filter((group) => group.items.length > 0);
}

/**
 * Breadcrumb trail for a path, derived from the nav tree so a renamed section
 * cannot drift from its breadcrumb.
 */
export function breadcrumbsFor(pathname: string): { label: string; to?: string }[] {
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (item.to === pathname) {
        return item.to === "/admin"
          ? [{ label: item.label }]
          : [{ label: "Panoramica", to: "/admin" }, { label: group.label }, { label: item.label }];
      }
    }
  }

  // A detail page below a known section, e.g. /admin/prodotti/abc123.
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (item.to !== "/admin" && pathname.startsWith(`${item.to}/`)) {
        return [
          { label: "Panoramica", to: "/admin" },
          { label: group.label },
          { label: item.label, to: item.to },
        ];
      }
    }
  }

  return [{ label: "Panoramica", to: "/admin" }];
}
