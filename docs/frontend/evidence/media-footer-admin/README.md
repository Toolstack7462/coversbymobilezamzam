# Media, footer and merchant dashboard review

These are real Chromium screenshots of the existing application against isolated, explicitly labelled demo fixtures. They do not show the live merchant database and do not certify product photography or availability.

Baseline source: main `c6db3cd7604b470933504099b03a7db1a3b2b527`. Storefront baseline captured in run [34876707550](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34876707550); admin baseline captured separately from that unchanged source in [34878765150](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34878765150), after the initial combined browser process failed. Screenshots have not been retouched.

| Surface                 | Before                          | After                         |
| ----------------------- | ------------------------------- | ----------------------------- |
| Admin desktop, 1440px   | [Before](before-admin-1440.png) | [After](after-admin-1440.png) |
| Admin mobile, 390px     | [Before](before-admin-390.png)  | [After](after-admin-390.png)  |
| Homepage/footer, 1366px | [Before](before-home-1366.png)  | [After](after-home-1366.png)  |

The final full artifact also covers storefront routes at 390/768/1366/1440px and 19 admin screens at 390/768/1440px. Full-page mobile storefront screenshots show the fixed navigation at the original viewport position; there is only one navigation element. The existing hero animation is retained. Missing product photographs are explicitly indicated, not replaced with unrelated merchandise images.

Final source: `73453081960afa149cefa28be56f3dadf8a753de`, all jobs green in [run 34879826419](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419). These selected final captures were manually inspected. Complete [storefront artifact](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419/artifacts/10363190437) and [admin artifact](https://github.com/Toolstack7462/coversbymobilezamzam/actions/runs/34879826419/artifacts/10363120468) expire 28 September 2026.
