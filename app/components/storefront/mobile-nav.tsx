import { Link, useLocation } from "react-router";
import { localePath, parseLocalePath, type Locale, type Translator } from "~/lib/i18n";

/**
 * Bottom navigation, phones only.
 *
 * The homepage is five thousand pixels tall on a 390px screen. Without this,
 * the only route back to search or the basket is scrolling all the way to the
 * top — which is the difference between a site that works on a phone and one
 * that is usable on a phone.
 *
 * Five destinations, which is the documented ceiling for a bottom bar: beyond
 * that the targets stop being reliably hittable with a thumb.
 *
 * Rendered as real links, so it works with no JavaScript, and hidden from
 * assistive technology only when it is visually hidden — never the reverse.
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
    { to: "/", label: t("common.home"), match: (p: string) => p === "/" },
    { to: "/shop", label: t("common.shop"), match: (p: string) => p.startsWith("/shop") },
    {
      to: "/trova-dispositivo",
      label: t("nav.find_by_device"),
      match: (p: string) => p.startsWith("/trova-dispositivo"),
    },
    { to: "/carrello", label: t("common.cart"), match: (p: string) => p.startsWith("/carrello") },
  ];

  return (
    <nav className="mobile-nav" aria-label={t("common.menu")}>
      <ul className="mobile-nav__list">
        {items.map((item) => {
          const current = item.match(pathname || "/");
          return (
            <li key={item.to}>
              <Link
                to={path(item.to)}
                className="mobile-nav__link"
                /* The current page is announced, not just coloured — colour
                   alone is not an accessible way to say "you are here". */
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
