import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAV, ADMIN_FEATURES } from "~/lib/admin-nav";

/**
 * Every admin link points at a route that exists.
 *
 * This test exists because I shipped four links to nothing. The products list
 * linked each row to `/admin/prodotti/:id` and its header offered "Aggiungi
 * prodotto" at `/admin/prodotti/nuovo`; neither route was registered. The setup
 * centre pointed at `/admin/compatibilita` and `/admin/contenuti/legale`, also
 * absent. Every one of them typechecked, rendered, and looked completely
 * correct — `<Link to="...">` takes a string, and React Router has no reason to
 * object until someone clicks.
 *
 * A merchant working through the setup checklist would have hit a 404 on a
 * screen whose entire job is telling them what to do next. That is a bad place
 * to lose someone's trust.
 *
 * So: parse the real route table, collect every `/admin/...` string literal in
 * the source, and require each one to match a registered pattern.
 */

const ROUTES_FILE = "app/routes.ts";

/**
 * Destinations of nav items behind a disabled feature flag.
 *
 * These are exempt, and the exemption is narrow on purpose. A flagged nav entry
 * is never rendered — `visibleNav` filters it out on the server — so it is a
 * declared intention, not a link a merchant can click. The moment the flag
 * flips to true the entry becomes reachable and this test starts requiring its
 * route, which is exactly when it should.
 *
 * Nothing outside the nav tree gets this exemption. A link from the action
 * centre or the setup checklist is reachable today, whatever the nav says.
 */
const FLAGGED_OFF = new Set(
  ADMIN_NAV.flatMap((group) => group.items)
    .filter((item) => item.flag !== undefined && !ADMIN_FEATURES[item.flag])
    .map((item) => item.to),
);
const SOURCE_DIRS = ["app/routes", "app/components", "app/domain", "app/lib"];

/** Registered paths, read from `route("<path>", ...)` in the route table. */
function registeredPaths(): string[] {
  const source = readFileSync(ROUTES_FILE, "utf8");
  return [...source.matchAll(/route\(\s*"([^"]+)"/g)]
    .map((m) => `/${m[1]}`)
    .filter((path) => path.startsWith("/admin"));
}

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(full) ? [full] : [];
    });
  return SOURCE_DIRS.flatMap(walk);
}

/**
 * Every `/admin/...` path that appears as a string or template literal.
 *
 * Template placeholders become `:param`, because `/admin/ordini/${row.id}` and
 * the registered `/admin/ordini/:orderId` are the same route.
 */
function emittedLinks(): { path: string; file: string }[] {
  const found: { path: string; file: string }[] = [];

  for (const file of sourceFiles()) {
    // Route modules name their own path in comments and meta; only string and
    // template literals are links.
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["'`](\/admin[a-zA-Z0-9/:?=&${}._-]*)["'`]/g)) {
      const raw = match[1]!;
      const path = raw
        .split("?")[0]!
        .replace(/\$\{[^}]*\}/g, ":param")
        .replace(/\/+$/, "");
      if (path === "" || path === "/admin") continue;
      found.push({ path, file });
    }
  }
  return found;
}

/** A registered pattern matches a link if every segment lines up. */
function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const l = path.split("/");
  if (p.length !== l.length) return false;
  return p.every((segment, i) => segment.startsWith(":") || segment === l[i]);
}

describe("admin links", () => {
  const registered = registeredPaths();

  it("finds the route table", () => {
    // If the parse breaks, every assertion below passes vacuously.
    expect(registered.length).toBeGreaterThan(15);
    expect(registered).toContain("/admin/prodotti");
  });

  it("finds links to check", () => {
    expect(emittedLinks().length).toBeGreaterThan(20);
  });

  it("points every link at a registered route", () => {
    const dangling = emittedLinks()
      // The exemption applies ONLY inside the nav module. The same path linked
      // from the setup checklist or the action centre is reachable today,
      // whatever the sidebar chooses to hide.
      .filter(({ path, file }) => !(FLAGGED_OFF.has(path) && file.includes("admin-nav")))
      .filter(({ path }) => !registered.some((pattern) => matches(pattern, path)))
      // A link written once in three files is one problem, not three.
      .reduce<Map<string, Set<string>>>((acc, { path, file }) => {
        (acc.get(path) ?? acc.set(path, new Set()).get(path)!).add(file.replace(/\\/g, "/"));
        return acc;
      }, new Map());

    const report = [...dangling.entries()].map(
      ([path, files]) => `${path}\n    linked from: ${[...files].join(", ")}`,
    );

    expect(report, `Links to unregistered routes:\n  ${report.join("\n  ")}`).toEqual([]);
  });
});
