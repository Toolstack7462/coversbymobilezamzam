# Storefront audit — 14 September 2026

## 14 September 2026 — media, footer and admin follow-up

This pass starts from current main `c6db3cd7604b470933504099b03a7db1a3b2b527`, not the old storefront review branch. The earlier storefront has since been incorporated into main. Work is isolated on `feat/media-footer-admin-polish`, draft PR #13. The independent `fix/admin-audit-and-refinement` branch was inspected but not merged or overwritten.

The footer was visually heavy and had a reserved fourth column even when CMS data produced three groups. It now uses an ivory surface, compact spacing and adaptive columns, retaining published help/legal links, contact wrapping and attribution. The neutral store invitation is pale blue with its CTA aligned beside the copy on desktop. An actual merchant store photo retains its separate media treatment.

The admin's long dark sidebar, repeated warnings and low-positioned metrics made daily tasks harder to scan. The light chrome uses the existing original ZZ identity, native collapsible navigation groups, a true desktop sidebar collapse, a mobile search link and a dashboard with metrics, priorities and setup/photo tasks. Current-route navigation opens automatically; permissions and financial queries stay authoritative.

A blocked primary product image could mask a usable secondary merchant photo. Database selection now applies the same known-defect predicate as presentation. Missing-photo counts, the saved product view and setup centre now agree. No genuine product photography was supplied or uploaded to production.

Baseline local verification passed all 11 gates (577 unit, 210 integration). Baseline CI run 34876707550 passed verification and the four-width storefront survey, but its shared browser server exited after 12 tests; the remaining connection failures are not accepted UI results. Browser projects and admin visual baselines now run on isolated CI jobs. Final application 7345308 passes all jobs in run 34879826419. Screenshot inspection found and corrected a mobile task-column ordering error; axe found and corrected photo-panel contrast. The final before/after evidence and precise test scope are recorded in acceptance.md.

## Source and release

- Repository: https://github.com/Toolstack7462/coversbymobilezamzam
- Initial remote main: `36d2c796dc7e07a572157ddc44f3fe8160c4a86b` (pre-Hostinger).
- Original implementation base: `origin/feat/hostinger-migration`, `6a90a7f5d41789770da86a1718f5c6f3e035eb5c`.
- Rechecked after GitHub connection: both main and the Hostinger branch now point to `0e98a140a07e4d6bf46417cb929bb391324b6c69`. The feature branch incorporates that deployment-script correction. Review can now target main without introducing the migration as part of the design diff.
- Working branch: `feat/storefront-premium-refinement`.
- GitHub connector confirms write access. Publication uses its Git object API because the shell has no GitHub credentials; no token is copied into the project. Only the feature ref is published.
- Public `/api/health` reported production build `0460f27cf6dc4f60d63d36f27b80e54bc28da78a`, dirty=true, builtAt `2026-09-14T10:55:54.796Z`. The deployed working-tree changes cannot be reconstructed from this commit identifier.
- GitHub workflow verifies pushes/PRs to main and contains no deployment action. Repository release notes say Hostinger Git integration targets main, but its current hPanel configuration was not accessible. Production auto-deployment cannot be ruled out from CI alone. Do not merge or push main for this change.
- Existing Hostinger deployment is SSR Node/Express, MariaDB and filesystem media, deployed as timestamped releases through a symlink. No hosting, auth, database, payment, stock or WhatsApp architecture replacement.
- The supplied Windows paths are not mounted. No Shopify reference code or assets were copied. Project-owned fonts retain their existing licences.

## Observed defects

| Area          | Evidence                                                                                                                                   | Correction                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Hero          | Live screenshot: large empty phone screen, shopping cues below the fold                                                                    | Compact two-column editorial composition, original vector-derived artwork, native CSS entrance and three working controls |
| SKU media     | 26 stock-photo assignments in product-image-credits.json; reported charger/wallet/hydrogel assignments confirmed in source and public page | Quarantine exact known keys in shared media policy; explicit photo-review state; replacement uploads remain authoritative |
| Branding      | Full wordmark present, no original symbol or favicon links                                                                                 | Reusable original cover/ZZ SVG, dark/light exports and icon set                                                           |
| Metadata      | Homepage uses old title; inner titles omit brand                                                                                           | React Router metadata on every existing storefront route; search/category/device context included                         |
| Finder        | Eight repeated large model panels                                                                                                          | Up to six catalogue-derived shortcuts, brand/model controls and full directory link                                       |
| Product cards | Homepage stock subqueries are not guaranteed to describe the priced variant                                                                | Suppress misleading homepage availability until an authoritative variant-level offer is resolved                          |
| Editorial     | Featured and chronological products overlap                                                                                                | One distinct merchant-selected feature, excluded from new-arrivals row; no feature without a usable image                 |
| Services      | Address presence enabled fixed repair/free-fitting promises                                                                                | Existing page CMS gains service type; only published service copy is shown                                                |
| Store         | Known Sulmona city photo presented behind shop content                                                                                     | Known city-photo key suppressed; neutral branded band, merchant replacement photos supported                              |
| Footer        | Six/seven columns, separate masthead, long address/email and top spacer                                                                    | Four purposeful groups, wrapping, published help/legal links, attribution retained                                        |

## Scope and limits

The live catalogue contains names, specifications, prices and compatibility originating in demo seed scripts. Matching public slugs and photo keys is evidence of that provenance, not merchant verification. No production data was changed and no demo product was relabelled as real inventory. Merchant confirmation is required before a production release can be accepted.

Customer account and standalone services routes do not exist in app/routes.ts. Do not fabricate them. Services use the existing `/pagine/:slug` route. Search and collections share `/shop`. All order and tracking URLs remain unchanged.

## Baseline

`npm run verify`: all 11 gates passed; 553 unit tests and 210 integration/security tests. Hostinger build also passed. Existing budget measurement: 132.5 KB storefront JavaScript, 84.5 KB admin JavaScript, 13.3 KB all-route CSS (gzip). These are build/lab figures, not field Core Web Vitals.

Before screenshots: evidence/before-home.jpg, cloud Chrome viewport 1363 × 936. These do not constitute a four-width baseline.

## Follow-up refinement

Rechecked main and feature branch before the follow-up: main remains `0e98a14`; the review branch contains `9ed1989`. GitHub CI run `34855705240` completed successfully, including the existing browser job. Live inspection still shows the pre-refinement homepage, so the feature has not been presented as a production release.

The next pass gives the hero a coherent navy accessory stage and useful per-mode guidance, strengthens category hierarchy, groups PDP purchase controls and introduces a responsive cart summary column. The existing GitHub browser suite now includes a separate storefront project to capture 390/768/1366/1440px screenshots, hero video, keyboard/reduced-motion checks, client-navigation titles and cart actions against an isolated demo catalogue. This is application test evidence; it is not a Hostinger staging deployment or a claim that demo products are genuine merchandise.

Final visual review: `8c07f39` passed CI run `34869020501`, including 181 existing browser tests and the 9-test storefront project. Four-width screenshots and the hero recording are retained under `evidence/`. The measured 13px mobile category overflow is corrected without hiding document overflow; discovery padding and footer heading scale were also refined after screenshot inspection. See `acceptance.md` for explicit lab/staging limits.

Final repository reconciliation: main advanced to c0be139 during this pass with a testing-dependency update. It was cleanly integrated into the feature branch as f5dfd81. Every CI job passed again in run 34881123192 with Playwright 1.63.0. Application/public assets remain identical to the reviewed 7345308 source. No production merge or deployment occurred.
