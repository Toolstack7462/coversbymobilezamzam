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
| Admin regression                                             | Existing integration/security checks; staff login SSR. Authenticated visual regression unverified                                                                                                              |
| Screenshots                                                  | Before: `evidence/before-home.jpg`, 1363×936. No after screenshot available                                                                                                                                    |
| Browser widths: 390/768/1366/1440                            | UNVERIFIED: cloud browser rejects local URLs; test-browser binary download timed out                                                                                                                           |
| Hero recording and browser frame cost                        | UNVERIFIED; no recording created                                                                                                                                                                               |
| Client navigation titles, focus, CSP, reduced motion         | Implemented; browser acceptance unverified                                                                                                                                                                     |
| Cart/variant, confirmation/tracking, admin media persistence | Existing integration coverage retained; full browser flow unverified                                                                                                                                           |
| Customer account / separate services route                   | Absent from existing application; no fake routes added                                                                                                                                                         |
| Hostinger Git auto-deployment                                | Release notes inspected; current hPanel configuration unverified                                                                                                                                               |
| Publication                                                  | GitHub connector now confirms write access; publish only `feat/storefront-premium-refinement`. Shell Git authentication is still absent; no credentials are copied into the workspace                          |
| Hosted preview                                               | Not deployed; isolated staging access still required                                                                                                                                                           |

## Build measurements

| Gzip metric           |   Before | Final updated pass |  Change |
| --------------------- | -------: | -----------------: | ------: |
| Storefront JavaScript | 132.5 KB |           135.1 KB | +2.6 KB |
| Admin JavaScript      |  84.5 KB |            84.5 KB |  0.0 KB |
| All-route CSS         |  13.3 KB |            16.8 KB | +3.5 KB |

Budget totals include shared and route chunks; they are not one navigation's transfer size. No animation dependency was added. Suppression of known image requests is an implementation change, not a measured browser improvement. No Lighthouse, frame-time, server-CPU or field Core Web Vitals result is claimed.

## Release blockers

1. Review `feat/storefront-premium-refinement` against main, now updated to the Hostinger application at `0e98a14`. Do not merge until visual approval. GitHub write access is now connected.
2. Verify hPanel auto-deployment settings and provide an isolated preview using the existing architecture. The public build reports a dirty working tree; reconcile those uncommitted deployment changes before production integration.
3. Verify merchant photographs and the seeded catalogue's specifications, availability and fit. Known city imagery is not a store photo.
4. Complete browser acceptance, interaction recording, accessibility, customer order flow and media-persistence checks on the preview before visual approval.

A green build does not establish visual acceptance.

## Accessory-stage browser evidence

The initial published commit `9ed1989` passed GitHub CI run `34855705240`, including its browser job. The follow-up adds `tests/browser/storefront-design.spec.ts` and an isolated identity fixture for the existing browser test database. Its new four-width screenshots and hero recording are uploaded by CI as `storefront-design-evidence`; execution status is recorded on the PR. Until that run completes, these new checks are pending rather than passed. Screenshots use explicitly labelled demo products, not the live merchant catalogue. No Hostinger staging deployment is implied.
