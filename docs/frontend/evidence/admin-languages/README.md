# Admin English / Italian evidence

These are unedited Chromium captures of the existing application using isolated CI fixtures.

| Files                                                                                        | Viewport widths         | Source                                                                                               |
| -------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `before-admin-390.png`, `before-admin-1440.png`                                              | 390, 1440 px            | Main `103fd13`, baseline visual job in run `34890090081`                                             |
| `after-admin-390.png`, `after-admin-768.png`, `after-admin-1366.png`, `after-admin-1440.png` | 390, 768, 1366, 1440 px | Application `cef3b8d1191a7f49c0b5c08198ec0e0832ee149e`, language browser checks in run `34891172528` |

The after screenshots show the English menu open, translated dashboard notes and English currency formatting. The full brand, environment badge and native keyboard focus remain visible. The mobile view wraps the wordmark without clipping the controls. Captures are full-page; viewport height is 768 px at width 1366, otherwise 900 px.

Baseline and after jobs use different isolated fixture workflows. Their counts, warnings and merchant display name are test data, not production stock or business performance. Merchant-entered names are deliberately not machine-translated. The unfinished setup and photo notices are real states of these fixtures.

[Application verification run](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34891172528) · [Review PR #16](https://github.com/Toolstack7462/coversbymobilezamzam/pull/16)

The CI artifacts also contain the existing storefront captures and hero interaction recording. The language pass does not change that animation. Previous storefront/footer before-and-after captures remain in `../media-footer-admin/`; original hero evidence remains at `../hero-interaction.webm`.

These captures support visual review. No isolated hosted preview or field Core Web Vitals measurement is available in this session, and production has not been deployed by this pass.
