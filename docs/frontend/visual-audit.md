# Storefront audit — 14 September 2026

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
