import { Link, useLocation } from "react-router";
import { localePath, parseLocalePath, type Locale, type Translator } from "~/lib/i18n";

/**
 * Bottom navigation, phones only.
 *
 * The homepage is five thousand pixels tall on a 390px screen. Without this the
 * only route back to search or the basket is scrolling all the way to the top —
 * the difference between a site that works on a phone and one that is usable on
 * a phone.
 *
 * Five destinations, which is the documented ceiling for a bottom bar: past
 * that the targets stop being reliably hittable with a thumb. Cart is last
 * because the right-hand end of the bar is the easiest place to reach, and it
 * is the one people go back to repeatedly.
 *
 * Real links throughout, so it works with no JavaScript.
 */

interface Props {
  t: Translator;
  locale: Locale;
}

export function MobileNav({ t, locale }: Props) {
  const location = useLocation();
  // The path with any /en prefix removed, so matching is locale-independent.
  const { pathname } = parseLocalePath(location.pathname);
  const path = (p: string) => localePath(locale, p);

  const items = [
    { key: "home", to: "/", label: t("common.home"), match: (p: string) => p === "/" },
    {
      key: "shop",
      to: "/shop",
      label: t("common.shop"),
      match: (p: string) => p.startsWith("/shop") || p.startsWith("/prodotti"),
    },
    {
      // "Trova per Dispositivo" wraps to two lines in a fifth of a 390px
      // screen. A bottom-bar label has room for one word.
      key: "device",
      to: "/trova-dispositivo",
      label: t("nav.device_short"),
      match: (p: string) => p.startsWith("/trova-dispositivo"),
    },
    {
      /*
       * Search jumps to the header's field rather than being a route of its
       * own. That field is already full-width on a phone, so a separate search
       * page would be a second way to do the same thing — and `#q` focuses it
       * with no JavaScript, because the target is an input.
       */
      key: "search",
      href: "#q",
      label: t("nav.search_short"),
      match: () => false,
    },
    {
      key: "cart",
      to: "/carrello",
      label: t("common.cart"),
      match: (p: string) => p.startsWith("/carrello"),
    },
  ];

  return (
    <nav className="mobile-nav" aria-label={t("common.menu")}>
      <ul className="mobile-nav__list">
        {items.map((item) => {
          const current = item.match(pathname || "/");
          // The current page is announced, not just coloured — colour alone is
          // not an accessible way to say "you are here".
          const ariaCurrent = current ? ("page" as const) : undefined;

          return (
            <li key={item.key}>
              {item.href ? (
                <a className="mobile-nav__link" href={item.href}>
                  {item.label}
                </a>
              ) : (
                <Link className="mobile-nav__link" to={path(item.to!)} aria-current={ariaCurrent}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
