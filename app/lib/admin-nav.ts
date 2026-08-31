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
  catalogueAdmin: false,
  inventoryDetail: false,
  promotions: false,
  content: false,
  customers: false,
  reviews: false,
  importExport: false,
  fulfilment: false,
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
        flag: "fulfilment",
        badgeKey: "pickupsToPrepare",
      },
      {
        label: "Spedizioni",
        to: "/admin/spedizioni",
        permission: "order.read",
        flag: "fulfilment",
      },
      { label: "Resi", to: "/admin/resi", permission: "order.read", flag: "fulfilment" },
      { label: "Clienti", to: "/admin/clienti", permission: "customer.read", flag: "customers" },
    ],
  },
  {
    label: "Catalogo",
    items: [
      { label: "Prodotti", to: "/admin/prodotti", permission: "product.read" },
      {
        label: "Categorie",
        to: "/admin/categorie",
        permission: "product.write",
        flag: "catalogueAdmin",
      },
      { label: "Marchi", to: "/admin/marchi", permission: "product.write", flag: "catalogueAdmin" },
      {
        label: "Famiglie prodotto",
        to: "/admin/famiglie",
        permission: "product.write",
        flag: "catalogueAdmin",
      },
      {
        label: "Dispositivi",
        to: "/admin/dispositivi",
        permission: "product.write",
        flag: "catalogueAdmin",
      },
      {
        label: "Compatibilità",
        to: "/admin/compatibilita",
        permission: "product.write",
        flag: "catalogueAdmin",
      },
      { label: "Recensioni", to: "/admin/recensioni", permission: "content.read", flag: "reviews" },
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
        flag: "inventoryDetail",
      },
      {
        label: "Rettifiche",
        to: "/admin/inventario/rettifiche",
        permission: "inventory.read",
        flag: "inventoryDetail",
      },
      {
        label: "Trasferimenti",
        to: "/admin/inventario/trasferimenti",
        permission: "inventory.transfer",
        flag: "inventoryDetail",
      },
      {
        label: "Scorte basse",
        to: "/admin/inventario/scorte-basse",
        permission: "inventory.read",
        flag: "inventoryDetail",
      },
      {
        label: "Prenotazioni",
        to: "/admin/inventario/prenotazioni",
        permission: "inventory.read",
        flag: "inventoryDetail",
      },
    ],
  },
  {
    label: "Promozione",
    items: [
      { label: "Sconti", to: "/admin/sconti", permission: "price.write", flag: "promotions" },
      {
        label: "Promozioni",
        to: "/admin/promozioni",
        permission: "price.write",
        flag: "promotions",
      },
      {
        label: "Prodotti in evidenza",
        to: "/admin/in-evidenza",
        permission: "product.write",
        flag: "promotions",
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
        flag: "content",
      },
      {
        label: "Menu e navigazione",
        to: "/admin/contenuti/menu",
        permission: "content.write",
        flag: "content",
      },
      {
        label: "Pagine",
        to: "/admin/contenuti/pagine",
        permission: "content.write",
        flag: "content",
      },
      {
        label: "Guide",
        to: "/admin/contenuti/guide",
        permission: "content.write",
        flag: "content",
      },
      {
        label: "Documenti legali",
        to: "/admin/contenuti/legale",
        permission: "content.publish",
        flag: "content",
      },
      { label: "SEO", to: "/admin/contenuti/seo", permission: "content.write", flag: "content" },
    ],
  },
  {
    label: "Impostazioni",
    items: [
      { label: "Impostazioni", to: "/admin/impostazioni", permission: "settings.read", end: true },
      { label: "Personale e ruoli", to: "/admin/personale", permission: "staff.read" },
      { label: "Sicurezza", to: "/admin/sicurezza", permission: null },
      {
        label: "Importa ed esporta",
        to: "/admin/importazioni",
        permission: "import.run",
        flag: "importExport",
      },
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
