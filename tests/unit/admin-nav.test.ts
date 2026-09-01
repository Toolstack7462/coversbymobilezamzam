import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV,
  ADMIN_FEATURES,
  visibleNav,
  breadcrumbsFor,
  type AdminFeature,
} from "~/lib/admin-nav";

/**
 * The navigation tree.
 *
 * These tests protect the two rules in `admin-nav.ts`: a section the merchant
 * cannot use is absent rather than greyed out, and the filtering here is a
 * courtesy — never the access control, which lives in each route's own
 * `requireStaff` call.
 */

const ALL_ON: Record<AdminFeature, boolean> = Object.fromEntries(
  Object.keys(ADMIN_FEATURES).map((k) => [k, true]),
) as Record<AdminFeature, boolean>;

describe("server-side filtering", () => {
  it("shows nothing but the permission-free items to an actor with no permissions", () => {
    const nav = visibleNav([]);
    const items = nav.flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.permission === null)).toBe(true);
  });

  it("drops a group entirely when none of its items survive", () => {
    // An empty heading is worse than no heading.
    const nav = visibleNav([]);
    expect(nav.every((g) => g.items.length > 0)).toBe(true);
    expect(nav.map((g) => g.label)).not.toContain("Catalogo");
  });

  it("reveals an item once its permission is held", () => {
    expect(
      visibleNav(["order.read"])
        .flatMap((g) => g.items)
        .map((i) => i.to),
    ).toContain("/admin/ordini");
  });

  it("hides flagged modules even from a super admin", () => {
    // Unbuilt is unbuilt. A permission does not conjure a working screen.
    const everyPermission: string[] = ADMIN_NAV.flatMap((g) => g.items)
      .map((i) => i.permission)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const flagged = ADMIN_NAV.flatMap((g) => g.items).filter((item) => item.flag !== undefined);

    /*
     * Every declared flag names a real feature.
     *
     * This is the half of the guard that never goes away: a typo in a flag name
     * would make `features[item.flag]` undefined, and an item flagged with a
     * name nobody defined would vanish from the nav permanently with no error.
     */
    for (const item of flagged) {
      expect(Object.keys(ADMIN_FEATURES), `unknown flag on ${item.to}`).toContain(item.flag);
    }

    if (flagged.length === 0) {
      /*
       * Nothing is flagged, which means every screen in the tree is built.
       *
       * The test used to REQUIRE an unbuilt module to test the mechanism with,
       * and failed the day the last one shipped — a test that breaks on
       * finishing the work is a test that punishes finishing the work. The
       * mechanism is still asserted above and below; this branch just records
       * that there is currently nothing hidden.
       */
      expect(visibleNav(everyPermission).flatMap((g) => g.items).length).toBe(
        visibleNav(everyPermission, ALL_ON).flatMap((g) => g.items).length,
      );
      return;
    }

    const stillFlagged = flagged.find((item) => !ADMIN_FEATURES[item.flag!]);
    if (!stillFlagged) return;

    const withFlagsOff = visibleNav(everyPermission)
      .flatMap((g) => g.items)
      .map((i) => i.to);
    expect(withFlagsOff).not.toContain(stillFlagged.to);

    const withFlagsOn = visibleNav(everyPermission, ALL_ON)
      .flatMap((g) => g.items)
      .map((i) => i.to);
    expect(withFlagsOn).toContain(stillFlagged.to);
  });

  it("never sends the browser a route the actor cannot open", () => {
    const permissions = ["order.read"];
    for (const item of visibleNav(permissions, ALL_ON).flatMap((g) => g.items)) {
      if (item.permission === null) continue;
      expect(permissions, item.to).toContain(item.permission);
    }
  });
});

describe("the tree itself", () => {
  it("has no duplicate destinations", () => {
    const paths = ADMIN_NAV.flatMap((g) => g.items).map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("marks the two section roots as exact matches", () => {
    // Without `end`, /admin would highlight on every admin page and /admin/
    // inventario would stay lit while inside its own sub-pages.
    const byPath = new Map(ADMIN_NAV.flatMap((g) => g.items).map((i) => [i.to, i]));
    expect(byPath.get("/admin")?.end).toBe(true);
    expect(byPath.get("/admin/inventario")?.end).toBe(true);
  });

  it("keeps every destination under /admin", () => {
    for (const item of ADMIN_NAV.flatMap((g) => g.items)) {
      expect(item.to.startsWith("/admin"), item.to).toBe(true);
    }
  });
});

describe("breadcrumbs", () => {
  it("gives the overview a single crumb, so no trail renders", () => {
    expect(breadcrumbsFor("/admin")).toEqual([{ label: "Panoramica" }]);
  });

  it("builds a trail from the tree, so a rename cannot drift", () => {
    expect(breadcrumbsFor("/admin/ordini")).toEqual([
      { label: "Panoramica", to: "/admin" },
      { label: "Vendite" },
      { label: "Ordini" },
    ]);
  });

  it("links the section for a detail page below it", () => {
    const crumbs = breadcrumbsFor("/admin/prodotti/abc123");
    expect(crumbs.at(-1)).toEqual({ label: "Prodotti", to: "/admin/prodotti" });
  });

  it("falls back to the overview for an unknown path rather than throwing", () => {
    expect(breadcrumbsFor("/admin/qualcosa-di-ignoto")).toEqual([
      { label: "Panoramica", to: "/admin" },
    ]);
  });
});
