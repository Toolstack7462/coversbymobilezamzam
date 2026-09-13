# Admin visual QA

How the control centre is checked, what the last run found, and what a
screenshot cannot tell you.

Run it with:

```sh
npx playwright test --project=visual
```

Images land in `test-results/admin-visual/<screen>-<width>.png`. They are build
output and are not committed.

---

## 1. What the survey asserts

Screenshots are the record, not the test. A page that returns 500 still
produces a perfectly good PNG, and a page that scrolls sideways on a phone looks
fine in a full-page capture. So every screen, at every width, must:

| Check                                             | Why                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP 200**                                      | A screenshot of an error page is still a screenshot.                                                                                   |
| **Exactly one `<h1>`**                            | Two means the page has not decided what it is; none means a screen reader cannot orient in it.                                         |
| **The `<h1>` matches the expected text**          | Catches a screen that renders the wrong route.                                                                                         |
| **Document does not scroll horizontally** (> 2px) | The definition of a page that is unusable on a phone. A wide table scrolling inside its own box is fine and is not what this measures. |

Two pixels of tolerance, because sub-pixel layout and scrollbar gutters produce
a rounding difference that is not a design fault.

---

## 2. Coverage

17 screens × 3 widths = **52 checks**.

**390** is the phone the merchant holds behind the counter. **768** is the
tablet width where a sidebar has to decide what it is. **1440** is the shop
computer.

| Screen                | Path                        |
| --------------------- | --------------------------- |
| Overview              | `/admin`                    |
| Products              | `/admin/prodotti`           |
| New product           | `/admin/prodotti/nuovo`     |
| Inventory             | `/admin/inventario`         |
| Orders                | `/admin/ordini`             |
| Payments              | `/admin/pagamenti`          |
| Customers             | `/admin/clienti`            |
| Devices               | `/admin/dispositivi`        |
| Compatibility         | `/admin/compatibilita`      |
| Brands and categories | `/admin/marchi`             |
| Homepage content      | `/admin/contenuti/homepage` |
| Pages                 | `/admin/contenuti/pagine`   |
| Settings              | `/admin/impostazioni`       |
| Staff                 | `/admin/personale`          |
| Security              | `/admin/sicurezza`          |
| Setup centre          | `/admin/configurazione`     |
| System health         | `/admin/sistema`            |

---

## 3. Last run

**52 passed, 0 failed** — every screen 200, one `h1`, no horizontal overflow, at
all three widths.

Functional suite alongside it: **91 passed, 0 failed, 2 skipped** across desktop
and mobile, including the axe accessibility sweep.

---

## 4. What the survey found, and what it took to see it

The survey was green on its first run — and that was the problem.

The browser suite seeded structure but **no catalogue**, so every list rendered
its empty state. Every table, filter, row, badge and pagination control in the
admin was unexercised, and a survey of empty screens proves nothing.

Once `seed-demo.mjs` was wired in, four real defects appeared immediately:

1. `out_of_stock` / `low_stock` / `in_stock` printed in English on the stock
   list, and the same on three other screens.
2. The product list had no image, no SKU and no stock column.
3. `.is-inert` pagination text at ~1.9:1 contrast — axe, serious.
4. `.ac-view__count` tab chips at 4.42:1 — axe, serious.

Numbers 3 and 4 could only render once there was more than one page of results
and more than zero rows in a view. **They were unreachable by inspection.**

A fifth defect was in the suite itself: the mobile card test asserted
`.ac-table thead` was not visible, and a locator matching nothing reports "not
visible" — so it had been passing with no table on the page at all.

---

## 5. What a screenshot cannot tell you

Stated so the images are not over-read.

| Not covered                       | Where it is covered                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Colour contrast                   | `accessibility.spec.ts`, axe-core, per screen                                                                                        |
| Keyboard order and focus          | Not automated. Manual.                                                                                                               |
| Whether a save actually persisted | `admin.spec.ts` workflow tests                                                                                                       |
| Whether a permission is enforced  | `tests/security/**`, server-side                                                                                                     |
| Real-device rendering             | A 390px Chromium viewport is not an iPhone. Font rasterisation, scrollbars and safe-area insets differ.                              |
| Anything on the MariaDB runtime   | The suite runs against `wrangler dev` and D1. The Node server serves the same routes but the admin suite has not been pointed at it. |
| Firefox, WebKit                   | Chromium only so far.                                                                                                                |

---

## 6. Reading the images

`test-results/admin-visual/<screen>-<width>.png`, full page.

The catalogue in every screenshot is the **synthetic `[DEMO]` fixture**, not the
merchant's data. That prefix is not decoration: anyone shown one of these
images has no other way to tell it from a real catalogue, and a price they act
on would be a price that was invented for a test.

No screenshot contains a credential, a TOTP secret, a payment proof or a real
customer record. The suite installs its own throwaway shop on every run and the
database is wiped before each one.
