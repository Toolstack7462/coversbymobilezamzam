# Acceptance and handoff

## Release boundary

Implemented in the existing application on `feat/storefront-motion-refresh`, based on PR #16 at `2b88965efc6ef966c950749e2011000775a7928c`. Review in [draft PR #17](https://github.com/Toolstack7462/coversbymobilezamzam/pull/17). Claude owns integration; reconcile PR #16 first. No main push, production merge, deployment or hosting configuration change occurred. GitHub CI only verifies; Hostinger's account-level branch automation could not be inspected here.

The source-supported Hostinger build is `npm run build:hostinger`, with root `./`, npm, Node satisfying `>=22.22.0` (CI uses 24), client output `build/client` and entry `build/server-node/index.js`. The Node server serves the built client and SSR application. A static Vite `dist` deployment does not represent this application's server architecture. Existing environment and persistence requirements remain in `docs/hostinger/deployment-runbook.md` and `environment-reference.md`; do not replace them with frontend environment guesses.

## Changed screens and components

| Area               | Files and resulting behaviour                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero               | `hero-showcase.tsx`, `home.tsx`, storefront CSS: integrated gradient, finite phone/accessory entrance, bounded pointer depth, accessible Protect/Charge/Connect states; complete SSR first render |
| Header/navigation  | `layout.tsx`, `mobile-nav.tsx`, scoped CSS: clearer search proportions, actual router pending feedback, existing navigation/current-page state preserved                                          |
| Finder/collections | `device-discovery.tsx`, `device-finder.tsx`, `collection.tsx`: six shortcuts, compact sequential URL-based controls, smaller filters and earlier products                                         |
| PDP/cards          | `product.tsx`, `compatibility-badge.tsx`, scoped CSS: stable gallery, real variant selection, matching stock/price/SKU/cart submission, pending feedback                                          |
| Footer/store       | `site-footer.tsx`, `store.tsx`, scoped CSS: light blue/slate gradient, four data-gated groups, real store information link, full identity, locale control and attribution                         |
| Cart/order/content | Existing cart, checkout, confirmation, tracking, guides/services and prose templates receive the scoped spacing, forms, typography and surface treatment; business actions unchanged              |
| Login exception    | `app/routes/admin/login.tsx`, new `app/styles/admin-login.css`: full approved logo, blue/stone gradient, decorative 2.5D plates, form-first mobile view; no auth/loader/action changes            |
| QA                 | `tests/browser/storefront-design.spec.ts`: responsive, motion, navigation, no-JS, variant/cart, media persistence and complete isolated test-order evidence                                       |

The login-only stylesheet also removes the shared mobile storefront navigation clearance from this route, which has no storefront navigation. It does not change shared base CSS or protected admin screens.

All storefront palette/layout rules remain scoped. No new runtime dependency, shared locale edit, database schema, payment/inventory service, server or deployment change. See `integration-request.md` for the minimal PDP loader addition and unresolved device-context integration.

## Verification actually executed

The measured application revision is `48edc8fa59a3de96b21e95f42d3b387bd47c3ef6`. [CI run 34898843246](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34898843246) passed all six jobs. Subsequent login-clearance/documentation changes are reviewed by the current PR checks; the measurement files deliberately retain the exact revision tested instead of silently relabelling measurements.

| Verification                                    | Result                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Local `npm run verify`                          | All 11 checks passed, including 584 unit and 219 Workers integration tests |
| `npm run build:hostinger` plus existing budgets | Passed; no budget changes                                                  |
| CI storefront                                   | 17 passed, no retries/failures                                             |
| CI desktop                                      | 77 passed, 2 pre-existing conditional skips                                |
| CI mobile                                       | 65 passed, 8 pre-existing conditional skips                                |
| CI admin visual                                 | Baseline and updated jobs passed; updated suite 58 passed                  |
| Browser widths                                  | 390×844, 768×1024, 1366×768, 1440×900, real Chromium                       |

Responsive screenshots cover `/`, `/shop`, `/trova-dispositivo`, `/prodotti/demo-cover-trasparente-iphone-16-pro`, `/carrello`, `/negozio`, `/admin/accedi`, `/checkout`, and the actual returned confirmation/tracking URLs. Confirmation and tracking are reached through the real test-order response, not invented public paths. Direct loads check one H1, one brand title and the SVG favicon; navigation checks updated titles. Existing browser suites retain locale/admin regression coverage.

The additional interaction checks cover:

- Keyboard hero modes, accessible names, retained focus, axe checks and readable intermediate motion state at 250ms; opaque heading/CTA throughout, entrance settles under three seconds.
- Bounded pointer depth/reset, stationary reduced-motion scene and complete no-JavaScript hero with usable shopping links.
- Deliberately delayed route response: loading status appears while the current page remains usable, then clears on completion. No fake delay or percentage in the application.
- Model filters, URL/history/back behaviour, finder steps and mobile search focus; no nested interactive elements or horizontal page overflow at the four widths.
- Selected out-of-stock Blue variant, correct €21.90 fixture price, disabled purchase; default/unknown selection fallback, persistent Black selection on reload; correct cart variant, quantities and removal. Includes no-JavaScript variant/cart submission.
- Authenticated admin upload of two explicitly labelled test PNG fixtures, real product gallery loading/anchors, image dimensions, alt-text edit/save/reload persistence. These fixtures are test inputs, never merchant photographs.
- Checkout, confirmation and token-protected tracking for an unpaid pickup test order. The test enables pickup/payment only in throwaway local CI D1, restores settings in `finally`, and sends no WhatsApp message or payment. Manual payment and inventory actions remain the existing implementation.
- No captured hydration/page errors or CSP violations in the exercised hero/navigation flow. A full production CSP audit was not possible here.

The first application review run found two test-harness races: reloads interrupted a variant navigation and an admin save POST. The tests now wait for the actual URL/selected state or completed POST before reload. Screenshot review also identified oversized collection gaps, an absent footer information group despite a valid address, and login mobile bottom clearance; each was corrected.

## Before/after lab measurements

Same production Workers build, isolated DEMO catalogue, Chromium CI, no network/CPU throttling. Three samples per route, a fixed 1.8-second observation window after fonts are ready, reused context; first navigation is colder than later samples. Values below are medians, not field Core Web Vitals, a conversion claim or Hostinger server CPU measurements.

| Route/width | LCP before → after (ms) | TTFB before → after (ms) | Encoded JS before → after (bytes) |
| ----------- | ----------------------- | ------------------------ | --------------------------------- |
| Home 1366   | 100 → 112               | 28.2 → 27.8              | 121039 → 120892                   |
| Home 390    | 88 → 96                 | 29.6 → 28.3              | 121039 → 120892                   |
| Shop 1366   | 84 → 108                | 31.1 → 22.5              | 120271 → 119901                   |
| PDP 1366    | 84 → 92                 | 33.3 → 29.7              | 120978 → 120654                   |

All 24 before/after samples have CLS 0. CSS transfer is 12894 → 15017 bytes. The fixture has no verified catalogue images: image bytes are zero in these samples, so image-rich production performance remains unmeasured. The independent media test verifies real uploads and loading behaviour. Initial baseline home navigation recorded one 54ms long task; other baseline and all after samples recorded none.

Existing aggregate gzip budgets: storefront 135.8 → 135.8 KiB (136 limit), admin 123.0 → 123.2 KiB (130 limit), CSS 18.0 → 21.1 KiB (45 limit). Clean builds were used so stale hashed output was not double-counted. No budget was raised.

The separate after-only browser rendering sample recorded 91 animation frames in 1.5 seconds, median/p95 frame gaps 16.7ms, zero gaps over 32ms. This is one CI interaction recording, not a universal FPS guarantee. Browser rendering and response TTFB are not server CPU measurements. Contrast checks include secondary text on the darkest footer gradient endpoint at 5.77:1 and white primary-button text at 5.41:1, plus browser axe checks.

## Evidence and remaining requirements

See `evidence/README.md` for exact baseline/after artifacts and raw samples. All screenshots show isolated DEMO inventory, never proof of actual merchant stock or production deployment. Screenshots were manually inspected across all four widths, including home, collection, finder, PDP, login and checkout. Fixed controls in full-page captures appear at the captured viewport position; interaction tests exercise the actual scrolling page.

Existing approved assets are reused: `public/brand/logo.svg`, `logo-reversed.svg`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, and the trusted brand SVG component. No manufacturer mark becomes this shop's identity.

Missing merchant requirements: verified photos for the 26 quarantined demo-image associations documented in `docs/frontend/image-mapping.md`; authoritative published editorial, guide/service/policy content and any confirmed shop photographs. No incorrect charger/wallet/hydrogel photo was reinstated. Existing CMS fields remain authoritative; no replacement frontend catalogue or media slots were created.

The fixture has no published guide/service/policy entries, so populated real-content states on those routes have not been newly browser-proven. No implemented public customer-account route was found; none was invented. Device choice persists in URL state, not a new browser profile; that gap is documented for Claude. The Windows Shopify reference was unavailable. Hostinger production configuration, actual live media performance and a hosted safe preview remain integration tasks. This handoff supplies source changes and real browser evidence for visual review; it does not assert a newly deployed preview URL.
