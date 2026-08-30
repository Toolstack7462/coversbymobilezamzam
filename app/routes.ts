import {
  type RouteConfig,
  type RouteConfigEntry,
  index,
  route,
  prefix,
  layout,
} from "@react-router/dev/routes";

/**
 * Routes.
 *
 * Italian paths are canonical and carry no prefix; English mirrors them under
 * `/en`. One page, one address per language (ADR 0009).
 *
 * Paths are Italian words because the audience is Italian and the URL is part
 * of the interface.
 *
 * The same route modules are mounted twice, so each copy needs an explicit
 * unique id - React Router derives ids from the file path, which would collide.
 */
function storefrontRoutes(idSuffix: string): RouteConfigEntry[] {
  const id = (name: string) => ({ id: `${name}${idSuffix}` });

  return [
    index("routes/storefront/home.tsx", id("home")),
    route("shop", "routes/storefront/collection.tsx", id("collection")),
    route("prodotti/:slug", "routes/storefront/product.tsx", id("product")),
    route("trova-dispositivo", "routes/storefront/device-finder.tsx", id("device-finder")),
    route("carrello", "routes/storefront/cart.tsx", id("cart")),
    route("cassa", "routes/storefront/checkout.tsx", id("checkout")),
    route(
      "ordine/:orderNumber",
      "routes/storefront/order-confirmation.tsx",
      id("order-confirmation"),
    ),
    route("traccia/:token", "routes/storefront/order-tracking.tsx", id("order-tracking")),
    route("negozio", "routes/storefront/store.tsx", id("store")),
  ];
}

export default [
  layout("routes/storefront/layout.tsx", [
    ...storefrontRoutes("-it"),
    ...prefix("en", storefrontRoutes("-en")),
  ]),
] satisfies RouteConfig;
