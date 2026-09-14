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

---

## The MariaDB runtime, and the four bugs it found

Added 2026-09-14.

Every browser test in this project ran against `wrangler dev` and D1. The
migration's own tests — 38 of them — ran against MariaDB, but the SCREENS never
had. So the admin a merchant will actually use had never once been rendered
from the database it will be served from.

```sh
npm run test:e2e:mariadb
```

`playwright.mariadb.config.ts` builds the Node server, drops and rebuilds
`zamzam_e2e` from the MariaDB migrations and the same demo seed the D1 suite
uses, installs the shop through the real first-run flow, enrols in two-factor,
and runs `admin.spec.ts` against it.

It is a **separate config**, not another project, because both builds write to
`build/client` and `build/server`: two web servers in one config would race to
overwrite each other's output. Run them one after the other, never together.

### What the first run found

Four bugs, none of which could fail on SQLite, and one of them a launch blocker.

| #   | Symptom on MariaDB                                                                                                                                                  | Cause                                                                                                                                                                                                                                                                                                    | Fix                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No administrator could be created at all.** The install form submitted, no account appeared, and the login page silently re-rendered.                             | Better Auth hands the adapter JavaScript `Date` objects. The MariaDB auth schema declared `created_at` as a plain `bigint`, so Drizzle passed the Date straight to mysql2 and MariaDB answered `Data truncated for column 'created_at'`. The SQLite schema uses `timestamp_ms`, which converts for free. | A `customType` in `db/schema/auth.mysql.ts` that stores BIGINT and converts Date ↔ epoch milliseconds, mirroring `timestamp_ms`.                                                  |
| 2   | `/admin/prodotti` returned 500: `syntax error … near '?1 OFFSET ?2'`.                                                                                               | An apostrophe in an SQL **comment** — "the merchant's catalogue" — opened a string literal that ran to the end of the statement, so the translator's placeholder rewrite skipped everything after it. SQLite accepts `?1` natively, so nothing running against D1 could see it.                          | The translator's scanner now treats `--` and `/* */` comments as non-code, and the two duplicate scanners it had are now one.                                                     |
| 3   | `/admin/inventario/trasferimenti` returned 500: `syntax error … near 'lines'`.                                                                                      | `lines` is reserved in MariaDB. The original reserved-word probe enumerated the schema's **columns**, and `(SELECT COUNT(*) …) AS lines` is an alias, not a column.                                                                                                                                      | Re-probed all 125 `AS <name>` aliases in the codebase against the real server; exactly one more was reserved. Added to the translator's quoting list.                             |
| 4   | `/admin/clienti` returned 500 twice over: first `Every derived table must have its own alias`, then `MoneyError: Money must be integer minor units, received 1990`. | The customer list is built entirely from derived tables (a "customer" is orders grouped by email, deliberately) and SQLite does not require them to be named. And `SUM()` over an INT column is DECIMAL in MariaDB, which mysql2 returns as a **string**; SQLite returns an integer.                     | All five derived tables aliased; the translator now refuses an unaliased one, so `npm run verify` catches the next; `decimalNumbers: true` on the pool, pinned by a MariaDB test. |

### What that says about the gap

These were not exotic. They were the product list, the customer list, the stock
transfers screen and **the ability to create the first administrator** — and
between them they would have made a Hostinger deployment unusable on its first
day. Every one of them was invisible to a suite of 179 browser tests, 686 unit
and integration tests and a 483-statement portability audit, for one reason:
none of it rendered a page from MariaDB.

Three of the four now have a check that runs without MariaDB — the translator's
comment handling and its derived-table rule are unit-tested and enforced by the
portability audit inside `npm run verify`. The other two need the real engine,
and that is what this suite is for.

### What it still does not cover

|                    |                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The workflow tests | `admin-workflows.spec.ts` asserts behaviour, and behaviour that differed between two SQL engines would already have failed the MariaDB integration tests. What had never been exercised was the RENDERING path, and that is what `admin.spec.ts` walks. |
| The storefront     | Measured extensively against MariaDB for performance, never asserted by a browser test there.                                                                                                                                                           |
| A phone viewport   | One project, desktop Chrome. The card-collapse test skips.                                                                                                                                                                                              |
| Hostinger          | Local MariaDB 10.11.19 on port 3399. Their server's version, its reserved words and its `sql_mode` are capability check C-2's business.                                                                                                                 |
