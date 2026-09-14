# Reproducible browser evidence

The application is the real repository production build running against an isolated, visibly marked DEMO fixture. These captures do not attest to production inventory or live deployment.

| Capture                                | Exact source                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline application                   | `2b88965efc6ef966c950749e2011000775a7928c`, screenshots in [run 34892219506](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34892219506)                                         |
| Baseline measurements                  | Measurement-only commit `6a688023c7d4037f8d256d4eb3461848ad7f757c`, [run 34895506014](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34895506014), storefront job `104148955681` |
| After application/screens/measurements | `48edc8fa59a3de96b21e95f42d3b387bd47c3ef6`, [run 34898843246](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34898843246), storefront job `104160072144`                         |
| After screenshots and recordings       | [Download storefront-design-evidence](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34898843246/artifacts/10368914859)                                                          |
| Latest integration revision            | [PR #17 checks](https://github.com/Toolstack7462/coversbymobilezamzam/pull/17/checks); each successful storefront job publishes a new artifact                                                       |

The configured CI screenshot/video retention is 14 days. The review download delivered with this PR preserves the before/after screenshots and selected real browser recordings outside that expiry. The raw measurement JSON is committed here. Storefront runtime assets do not include QA screenshots or videos.

Within the after artifact:

- `storefront-design-storefront-fits-<width>px-storefront/` contains home, shop, finder, cart, product and store full-page PNGs at 390, 768, 1366 and 1440px.
- `storefront-design-branded-*/` contains the full-logo login at all four widths.
- `storefront-design-configur-*/` contains checkout, confirmation and tracking at all four widths, reached by submitting the existing unpaid test-order flow.
- `storefront-design-hero-int-*/video.webm` records actual keyboard Protect/Charge/Connect interaction.
- `storefront-design-hero-ent-*/video.webm` records entrance, pointer depth and reduced-motion checks; `storefront-hero-midpoint.png` captures the paused 250ms state.
- `storefront-design-slow-nav-*/video.webm` shows the deliberately delayed-response test and visible router loading feedback.

`before-measurements.json` and `after-measurements.json` are the 12 unmodified `STOREFRONT_LAB` samples from their respective job logs. `rendering-measurement.json` records the separate after-only browser animation sample. Method, bundle totals, limitations and route coverage are in `../acceptance.md`.
