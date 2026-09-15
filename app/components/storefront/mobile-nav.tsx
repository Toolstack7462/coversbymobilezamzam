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
    ["/", "common.home"],
    ["/shop", "common.shop"],
    ["/trova-dispositivo", "nav.device_short"],
    ["#q", "nav.search_short"],
    ["/carrello", "common.cart"],
  ];

  return (
    <nav className="mobile-nav" aria-label={t("common.menu")}>
      <ul className="mobile-nav__list">
        {items.map(([to, label]) => (
          <li key={to}>
            {to === "#q" ? (
              <a className="mobile-nav__link" href={to}>
                {t(label!)}
              </a>
            ) : (
              <Link
                className="mobile-nav__link"
                to={path(to!)}
                aria-current={
                  pathname === to ||
                  (to !== "/" && pathname.startsWith(to!)) ||
                  (to === "/shop" && pathname.startsWith("/prodotti"))
                    ? "page"
                    : undefined
                }
              >
                {t(label!)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
