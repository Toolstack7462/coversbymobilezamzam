# Acceptance record

## Current language follow-up — 14 September 2026

Work is isolated on `feat/admin-english-storefront-locales`, based on `2a238d8`. This section supersedes the release status of the preceding PR #13 pass, whose refinements are retained. Main `103fd13`, including PR #13, was subsequently integrated into the feature branch. No production merge, deployment or merchant-media mutation is performed.

Initial baseline: all 11 verification gates pass. New language implementation: 584 unit tests and 219 worker integration/security tests pass; the Hostinger production build also passes. Local format, lint, typecheck, locale generation/parity, migration, SQL portability, unit/integration tests, build, budgets and secret scan pass. Six new integration tests invoke the actual storefront loaders/cart reader and language action against migrated D1: English content, empty/missing fallback, subsequent merchant edits, stable cart identity/quantity, private cookie and origin/redirect validation. Unit coverage includes URL prefix idempotence, filters/fragments, dictionary placeholders and English number grouping.

Worker build gzip totals: storefront JS **135.4 → 135.8 KB**, admin JS **85.2 → 122.9 KB**, CSS **17.9 → 18.0 KB**. The admin limit is explicitly adjusted to 130 KB for the new English interface after compaction; other limits stay unchanged.

First CI run `34888635443` passes Verify and all three visual-review jobs. Functional checks exposed test assumptions: APIRequestContext does not send the Secure preference cookie over HTTP loopback like Chromium navigation; the product name includes its required label; the payment heading is “Payment verification”; the no-JS login test assumed the first form was the login form. Assertions now use the real browser SSR response and explicit controls. Visual review also corrected a missing space before the product location. Follow-up run `34890090081` passes desktop (77 passed, 2 intentional skips), mobile (65 passed, 8 intentional skips), Verify and both admin visual jobs. Its storefront job stopped during shared first-run authentication setup: the enrolment redirect arrived after the helper checked its URL. The helper now awaits the destination and resolves the protected route before inspecting the login state. Authentication rules remain unchanged. A final run also covers translated multi-field validation and order-status feedback. `tests/browser/languages.spec.ts` exercises authenticated navigation across 36 actual admin URLs, sign-in SSR, persistent language, native no-JS switching, footer filter/fragment retention, English titles, keyboard/axe and 390/768/1366/1440px captures. Existing commerce and media workflows remain in the CI suite. All seven language scenarios pass on desktop and mobile in run `34890090081`, including English product creation and persisted merchant name, SKU and price. Final combined CI evidence is pending.

No hosted preview is available yet. CI uses isolated demonstration data; screenshots do not verify production inventory or field Core Web Vitals. Missing merchant product photos remain listed in image-mapping.md.

## Current follow-up — PR #13 (14 September 2026)

This section supersedes the earlier branch/publication status below. The pass started at `c6db3cd`; current main `c0be139` was subsequently integrated into the review branch without conflicts. The original storefront is already incorporated into main. The media/footer/admin work is on `feat/media-footer-admin-polish`, draft [PR #13](https://github.com/Toolstack7462/coversbymobilezamzam/pull/13). No merge, production deployment or production media mutation was performed in this pass.

- Local `npm run verify`: all 11 gates pass; 577 unit and 213 integration tests. Hostinger production build also passes.
- Worker build gzip totals: storefront JS 135.0 → 135.4 KB; admin JS 84.5 → 85.2 KB; all-route CSS 16.9 → 17.9 KB. Existing budgets pass without increases; these are aggregate build measurements, not page transfer size or field Core Web Vitals.
- First implementation CI run 34878765150: verification, storefront (9 tests), baseline admin visual and updated admin visual jobs pass. Desktop/mobile functional runs each expose one contrast failure on the photo-task panel; its text token is corrected. Manual screenshot review also caught task descriptions flowing into the narrow count column on mobile, despite no document overflow. The mobile grid now explicitly places the body and link; a readable-width regression check is added. Final application revision `73453081960afa149cefa28be56f3dadf8a753de` passes every job in [run 34879826419](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419). Baseline run 34876707550 had an unrelated shared Wrangler process termination after 12 tests; that failed run is not treated as passing.
- Source changes: storefront/admin styles, footer, neutral photo placeholder, product image-selection queries, missing-photo view/setup count, dashboard, shared admin shell and product editor photo guidance. Existing authentication, payments, inventory mutations and Hostinger architecture are retained.
- Still required: real merchant/supplier photographs for the 26 known unsuitable assignments, merchant verification of seeded specifications/stock, and a verified shop photo. No new photography was fabricated.
- Hosting: current release documents were inspected, but hPanel settings and an isolated hosted preview are not independently available in this session. Browser evidence is built from isolated fixtures, not production customer data.

**Status: feature-branch review, not approved for production.** No production merge, deployment or database/media write was performed. The GitHub pull request records publication and remote CI status.

## Final follow-up browser evidence

| Job / scope                     | Final result                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Verify                          | All CI gates pass: 577 unit, 213 integration and 36 security tests; unchanged budgets                                         |
| Desktop Chromium                | 70 passed, 2 intentional viewport skips                                                                                       |
| Mobile Chromium                 | 59 passed, 7 intentional workflow/viewport skips                                                                              |
| Admin visual survey             | 58 passed (setup plus 19 screens × 390/768/1440px); baseline also passes separately                                           |
| Storefront visual / interaction | 9 passed; 20 screenshots covering home, shop, device finder, PDP and cart at 390/768/1366/1440px                              |
| Photo persistence               | Existing browser upload, alt-text editing, reorder and deletion workflow passes against isolated fixture storage              |
| Navigation / accessibility      | Existing admin/public axe sweeps, no-JS menu and photo repair path, desktop sidebar collapse and mobile task-width check pass |

No retries or failures are reported in the final run. Job totals include separate fixture-setup tests; they must not be summed as unique tests. Intentional skips are explicitly reported, not hidden.

Six unretouched before/after PNGs are retained in [the review folder](evidence/media-footer-admin/README.md). Final dashboard images at 390/1440px, product-list images at 390/768/1440px and storefront images at 390/1366px were manually inspected across the review and correction passes. The mobile task-column failure found in the first screenshots is resolved in the final captures. No further browser test expansion is needed for this UI pass.

Full run artifacts (expire 28 September 2026): [storefront screenshots and recordings](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419/artifacts/10363190437), [updated admin screenshots](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419/artifacts/10363120468), [admin baseline](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419/artifacts/10361444916). The existing hero animation is retained, with new interaction recordings in the storefront artifact. No hosted preview was deployed; production/merchant-media acceptance remains outstanding.

Final Hostinger build also passes. Aggregate gzip impact relative to this pass's baseline is +0.4 KB storefront JS, +0.7 KB admin JS and +1.0 KB all-route CSS. No new image download or animation dependency is introduced by the source changes. Screenshots are review assets, not storefront assets. Browser frame times, server CPU and field Core Web Vitals were not measured in this pass.

## Current-main integration verification

Main advanced during finalization to `c0be139c9f3625173700ff97ba1c30b2c837ef1c` (Playwright 1.63.0 and a compatible Vitest-major hold). It was merged into the feature branch as `f5dfd8119e102691dc1080513c9493183b2227fc`; no force-push or production-branch write was performed.

[Run 34881123192](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34881123192) passes all six jobs against the updated dependencies: verification, desktop 70 passed/2 intentional skips, mobile 59 passed/7 intentional skips, admin visual 58 passed, storefront 9 passed, and the separate admin baseline. No failures or retries are reported. The application and public assets are byte-for-byte unchanged from the manually reviewed `7345308` source; the retained PNGs accurately identify that capture revision.

Current-run artifacts: [storefront and hero recordings](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34881123192/artifacts/10363127365), [updated admin](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34881123192/artifacts/10362313736), [baseline admin](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34881123192/artifacts/10363525130). These are isolated CI fixtures, not a hosted merchant preview. Later report-only commits do not change the verified application.

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
