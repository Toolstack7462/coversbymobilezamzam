# Acceptance record

**Status: feature-branch review, not approved for production.** No production merge, deployment or database/media write was performed. The GitHub pull request records publication and remote CI status.

## Changes

- Identity: `brand-symbol.tsx`, `brand-lockup.tsx`; full/reversed logo SVGs, SVG/ICO favicon and Apple touch PNG in `public/`.
- Homepage: `hero-showcase.tsx`, `device-discovery.tsx`, `home.tsx`; compact composition, transform motion, reduced-motion alternative, catalogue controls, one image-backed editorial feature, deduplicated rows, published services and existing section-heading/hero-copy controls.
- Shell/templates: `storefront.css`, storefront `layout.tsx`, `site-footer.tsx`, `product-card.tsx`; responsive container, card/gallery treatment and four footer groups. Custom admin, auth, cart mutations, payments, database adapters, inventory, tracking and WhatsApp implementation retained.
- Metadata: `storefront-meta.ts`, root icon links and meta exports on all existing storefront routes.
- Media: `storefront-image.ts`, PDP/card filtering, disabled stock-photo SKU seeder. No product or historical order records rewritten.
- CMS: existing Pagine editor gains a service type, without a new URL or schema migration.
- Four focused media/title regression tests in `tests/unit/storefront-image.test.ts`.

## Verification

| Check                                                        | Evidence / result                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline verification                                        | All 11 gates passed; 553 unit tests, 210 integration tests                                                                                                                                                     |
| Updated verification                                         | Final `npm run verify`: all 11 gates passed, 557 unit tests and 210 integration tests (61.1s; accessory-stage follow-up)                                                                                       |
| Hostinger build                                              | Passed locally; building does not deploy                                                                                                                                                                       |
| Direct SSR smoke                                             | PDP, homepage, catalogue/search, finder, cart, checkout, store, English home and staff login all returned 200 from the actual built application against isolated local demo data; `evidence/ssr-routes.json`   |
| Titles and icons                                             | One title per successful HTML response, exact homepage title and full brand verified after configuring the isolated fixture with the user-confirmed identity; SVG/ICO/PNG return 200 and correct content types |
| Image mapping                                                | 26 known stock-photo assignments audited; exact-key suppression and new-upload acceptance tested                                                                                                               |
| Admin regression                                             | Existing integration/security checks; staff login SSR. PASS: existing Chromium browser suite, including authenticated admin visual survey, in run 34869020501                                                  |
| Screenshots                                                  | Before: `evidence/before-home.jpg`, 1363×936. Four-width CI screenshots captured; final PNGs in `evidence/after-home-{390,768,1366,1440}.png`                                                                  |
| Browser widths: 390/768/1366/1440                            | PASS: Chromium on all four widths; corrected category sizing. 20 page/viewport screenshots in CI artifact                                                                                                      |
| Hero recording and browser frame cost                        | PASS: `evidence/hero-interaction.webm` (3.92s). Browser frame-cost and server CPU have not been measured                                                                                                       |
| Client navigation titles, focus, CSP, reduced motion         | PASS: client title, keyboard, hero axe/CSP checks, static no-JS links and reduced-motion transforms/zero animations                                                                                            |
| Cart/variant, confirmation/tracking, admin media persistence | Variant add/update/remove passed in Chromium; existing order/admin browser checks passed. Production media persistence and merchant order acceptance remain staging checks                                     |
| Customer account / separate services route                   | Absent from existing application; no fake routes added                                                                                                                                                         |
| Hostinger Git auto-deployment                                | Release notes inspected; current hPanel configuration unverified                                                                                                                                               |
| Publication                                                  | Published `feat/storefront-premium-refinement`, draft PR #12. App revision `8c07f39` passed all three CI jobs in run 34869020501; final evidence commit changes docs/assets only                               |
| Hosted preview                                               | Not deployed; isolated staging access still required                                                                                                                                                           |

## Build measurements

| Gzip metric           |   Before | Final updated pass |  Change |
| --------------------- | -------: | -----------------: | ------: |
| Storefront JavaScript | 132.5 KB |           135.0 KB | +2.5 KB |
| Admin JavaScript      |  84.5 KB |            84.5 KB |  0.0 KB |
| All-route CSS         |  13.3 KB |            16.9 KB | +3.6 KB |

Final table uses the Hostinger build; the Worker build measured 135.1 KB before the last CSS-only correction. Budget totals include shared and route chunks; they are not one navigation's transfer size. No animation dependency was added. Suppression of known image requests is an implementation change, not a measured browser improvement. No Lighthouse, frame-time, server-CPU or field Core Web Vitals result is claimed.

## Release blockers

1. Review `feat/storefront-premium-refinement` against main, now updated to the Hostinger application at `0e98a14`. Do not merge until visual approval. GitHub write access is now connected.
2. Verify hPanel auto-deployment settings and provide an isolated preview using the existing architecture. The public build reports a dirty working tree; reconcile those uncommitted deployment changes before production integration.
3. Verify merchant photographs and the seeded catalogue's specifications, availability and fit. Known city imagery is not a store photo.
4. Review the captured browser evidence, then complete Hostinger preview acceptance with merchant media and a customer order/media-persistence flow before production approval.

A green build does not establish visual acceptance.

## Accessory-stage browser evidence

The initial published commit `9ed1989` passed GitHub CI run `34855705240`. Final application revision `8c07f39` passed run [34869020501](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34869020501): verification, 181 existing browser tests (9 intentional skips), and 9 storefront-project tests including fixture setup. No failures or retries were reported in the final run.

The [complete CI artifact](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34869020501/artifacts/10357479536) contains 20 screenshots: homepage, shop, finder, empty cart and PDP at 390/768/1366/1440px, plus recordings. It expires 28 September 2026. Four homepage PNGs and the hero video are also retained in this repository. `after-hero.jpg` is an unmodified-size frame extracted at 1s from that recording.

The screenshots use explicitly labelled demo products, not the live merchant catalogue. They were visually inspected, including responsive category sizing, footer typography and purchase controls. Fixed mobile navigation appears partway down full-page screenshots because it is fixed to the original viewport; that capture behavior is not a second navigation element. No hosted Hostinger preview or field performance result is implied.

## Browser findings and corrections

Run `34868286229` completed 180 existing browser tests with 9 intentional skips; its only failure was mobile homepage overflow. The separate storefront project captured 20 route/viewport screenshots, exercised cart variants and recorded the hero. Category tiles with a minimum height and an unconstrained aspect-ratio width extended 13px beyond the 390px viewport. Their width now follows the grid column. No page-level overflow hiding was added.

The reduced-motion check exposed transient control transitions even though the illustrated objects remained stationary. All showcase descendant transitions are now explicitly disabled under reduced motion. The final code revision is `8c07f39`; run `34869020501` completed successfully. Storefront review now has an independent CI runner and database so admin catalogue mutations cannot change review screenshots. Earlier Wrangler process termination was an infrastructure failure, not a passing browser run.
