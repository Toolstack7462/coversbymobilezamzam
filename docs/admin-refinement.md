# Admin refinement

What was found in the merchant control centre, what was changed, and what was
deliberately left alone.

Audited and changed on 2026-09-13/14, on `feat/hostinger-migration`, starting
from `b3bda30` and ending at `85c9950`.

---

## 1. What the audit actually found

The brief expected an admin that needed refining. It found one that was already
close: the dark-chrome shell, the attention centre, the saved-view tabs, the
setup gates, the "Valore degli ordini — ordini creati, non incassati" wording
that refuses to call unpaid orders revenue, and the explicit refusal to draw a
chart for four orders are all already there and all correct.

So this is not a redesign. It is four real defects and one missing piece.

**The most useful thing the audit did was notice that the browser suite had
been passing vacuously.** It seeded structure but no catalogue, so every admin
list rendered its empty state. Nothing about tables, filters, rows, stock,
badges or pagination had ever been exercised, and four of the five findings
below were invisible until there was data on the screen.

### Findings

|     | Severity | Finding                                                                                              |
| --- | -------- | ---------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | Every page on Cloudflare returned 500. Introduced by this migration; not caught by `npm run verify`. |
| 2   | **P1**   | Five admin screens printed raw English enum values to an Italian merchant.                           |
| 3   | **P1**   | The product list had no image, no SKU and no stock — it could not be scanned.                        |
| 4   | **P1**   | Two WCAG 2.2 AA contrast failures, both flagged by axe once a catalogue existed.                     |
| 5   | **P1**   | The browser suite asserted things that were true of an empty page.                                   |

---

## 2. P0 — every Cloudflare page was a 500

`@react-router/node` and `@react-router/express` were installed two commits
earlier for the Hostinger server. React Router chooses its default SSR entry by
inspecting the dependency list:

```js
hasNodeDependency = @react-router/node || @react-router/express || @react-router/serve
```

Installing an Express adapter therefore switched the **Cloudflare** build to
`renderToPipeableStream`, which does not exist in `react-dom/server.edge`:

```
TypeError: (0 , import_server_edge.renderToPipeableStream) is not a function
```

`npm run verify` stayed green the whole time. It type-checks and builds; it
never serves a page. The browser suite caught it on the first run.

Confirmed rather than assumed: a worktree of `baseline/pre-hostinger-migration`
was built and its bundle contains only `renderToReadableStream`.

**Fix.** Both entries are explicit now — `app/entry.server.tsx` (Web Streams)
and `app/entry.server.node.tsx` (Node streams) — with `vite.node.config.ts`
aliasing one to the other for the Node build. A user entry always wins over the
generated default, so adding or removing an adapter package can no longer change
how either runtime renders.

**Trade-off.** Two files to keep in step. The header of each says so and names
the other; both were derived from React Router 8.3.1's own defaults so a
framework upgrade is a diff against a known original.

**Rollback.** Delete both files and the alias; the generated default returns.

---

## 3. P1 — the admin spoke English in five places

An Italian shopkeeper reading their own stock list saw:

```
out_of_stock      low_stock      in_stock
```

and the same on payments, pickups and both staff screens.

CLAUDE.md already records a merchant being shown a filter chip reading
`awaiting_customer_contact`. It kept happening because the Italian labels lived
beside the screens that remembered to use them, so a new screen simply did not
know they existed.

**Fix.** `app/components/admin/status-badge.tsx` is the one place that knows
every state in the system — orders, payments, products, availability, staff and
compatibility. It reuses the `ORDER_STATUS_LABELS`, `PAYMENT_STATUS_LABELS` and
`COMPATIBILITY_LABELS` maps that already existed, and adds the three sets that
had no labels anywhere.

An unknown value is shown **humanised in the warning tone** and logged in
development. Not hidden, not passed through raw: a state nobody has translated
is a real gap, and the merchant should see that something is there while the
next developer is told about it in the console rather than by a customer.

The duplicate `StatusBadge` in `products.tsx` is gone.

**Result.** Five screens now read `Esaurito`, `In esaurimento`, `Disponibile`,
`Sospeso`, `Verificato`.

---

## 4. P1 — the product list could not be scanned

Columns were: Product, Brand, Status, Price, Variants, Compatibility. The brief
asks for Image, Product, SKU, Price, Stock, Compatibility, Status, Actions.

Missing: **image, SKU, stock.** A merchant looking for "the blue one" opened
rows until they found it, and could not tell what was in stock without clicking
into each product.

**Fix.** All three added as correlated subqueries inside the existing statement,
matching what `min_price` already did — so the busiest screen in the admin does
not gain an N+1.

```sql
(SELECT pi.object_key FROM product_images pi WHERE pi.product_id = p.id
  ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1)        AS image_key,
(SELECT v.sku FROM product_variants v WHERE ... LIMIT 1)          AS first_sku,
(SELECT SUM(il.on_hand - il.reserved) FROM inventory_levels il ...) AS available,
(SELECT COUNT(*) ... WHERE (il.on_hand - il.reserved) <= 0)       AS depleted_variants
```

Four decisions worth recording:

- **`available` NULL means not tracked, and is never shown as 0.** A product
  with no inventory rows is one the shop does not count, which is a different
  fact from counting it and having none.
- **A sum hides the shape.** Three of one colour and none of another still
  totals three, so the cell also says how many variants are gone: the
  difference between "in stock" and "in stock, but not the one the customer
  asked for".
- **A multi-variant product shows one SKU with `+N`.** Printing one of several
  SKUs as if it were _the_ SKU is a small lie that costs somebody a wrong order.
- **The thumbnail lives inside the product cell, not in its own column.** A
  column cost width on a table that was already cramped and produced an
  unlabelled circle at the top of every card on a phone. Beside the name it
  needs no header, no width and no label.

### The width fix that first made it worse

`Column` gained `width` and `nowrap`, applied through `<colgroup>`.

That alone made the layout **worse**: a colgroup width is only a _suggestion_
under auto table layout, so the browser wrapped the product name — whose content
can wrap — in order to satisfy the SKU column it had been told not to. Names
went to four lines.

A `min-inline-size` on the cell is not negotiable, so the name column keeps a
readable measure and the pressure falls on columns that can absorb it. The
`<colgroup>` stays because it is the right mechanism for the hint; the cell
constraint is what binds.

---

## 5. P1 — two WCAG 2.2 AA contrast failures

Both found by axe, and only once a catalogue existed for the controls to render
at all.

| Element                               | Before                   | After                                          | Why                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.is-inert` (pagination, unavailable) | `opacity: 0.45` → ~1.9:1 | `--color-text-secondary`, **4.97:1**           | Exactly the "reduced text opacity that fails contrast" the brief forbids. Opacity fades ink and border together and keeps no floor. The control still reads as unavailable, and a merchant can now read what it says. |
| `.ac-view__count` (tab count chip)    | 4.42:1                   | `--color-text-secondary-on-sunken`, **6.69:1** | It inherited the on-page secondary colour while sitting on a sunken chip. The project already had the right token; this was the one place not using it.                                                               |

Neither was visible to review.

---

## 6. P1 — the browser suite was passing vacuously

The webServer chain seeded `seed.mjs`, which creates settings, roles,
permissions, a location, a price list and payment methods — and **no catalogue,
deliberately**. So every admin list rendered its empty state.

The clearest symptom: the mobile card test asserted `.ac-table thead` was not
visible. A Playwright locator that matches nothing reports "not visible", so the
test passed on a page with no table at all.

**Fix.**

- `seed-demo.mjs` gains `--persist-to`, mirroring `seed.mjs` including its
  refusal to combine with `--remote`. The suite now seeds a `[DEMO]`-prefixed
  catalogue — synthetic staging fixture, visibly not real merchant data.
- The card test now asserts what it means: a row exists, the header occupies no
  layout space (≤ 2px), and the row computes to `display: block`. The header
  stays _visually hidden_ rather than removed, which is what the CSS always
  intended — `isVisible()` does not understand `clip-path`, so the old
  assertion contradicted the CSS's own comment.
- `tests/browser/admin-visual.spec.ts` surveys 17 screens at 390 / 768 / 1440
  and asserts HTTP 200, exactly one `<h1>` with the expected text, and no
  horizontal document overflow — then screenshots. A screenshot of a 500 is
  still a perfectly good PNG, so the assertions are the point and the images
  are the record.

### And the survey then broke the suite

Run under both device projects it produced 104 navigations where 52 do the job,
each with a full-page screenshot, and the shared `wrangler dev` stopped
answering partway through — the exact failure mode `playwright.config.ts` warns
about two screens above where the survey was added.

It is now its own project with one worker, excluded from `desktop` and `mobile`.

---

## 7. What was deliberately NOT changed

|                          | Why                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The visual direction     | Dark chrome, light content, restrained metrics, no decorative charts. It already matches the brief. Changing it would be churn.                                  |
| The navigation groups    | Panoramica / Vendite / Catalogo / Inventario / Contenuti / Impostazioni already match the suggested hierarchy.                                                   |
| The dashboard            | It is built around decisions, labels unpaid orders honestly, and refuses to draw a chart for four orders.                                                        |
| The storefront           | Not one storefront file was touched. Every rule added is inside the `.ac` namespace.                                                                             |
| Product editor structure | Changed in the second pass — section nav, conflict guard, server-sourced save time — but still one long form rather than per-type templates. See §8.             |
| Adding indexes           | The catalogue is 26 products. An index costs write time on every import, and adding one against 26 rows is guessing at a plan the optimiser has not had to make. |

---

## 8. Second pass — what the "not done" list became

The table below was written at the end of the first pass. It is kept, rather
than deleted and rewritten, because a gap list that quietly disappears is not
evidence of anything. Each row now carries what happened to it.

| First-pass gap                                                                                                                                                              | Outcome                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topbar: brand identity, View store, global search, global add-product                                                                                                       | **Done.** The topbar carries the brand, a link to the storefront, the global search field and the add-product action.                                                                                                                                                                                                                                               |
| Global search                                                                                                                                                               | **Done.** `/admin/cerca` searches orders, products, customers and devices in four bounded lookups, each gated on the permission that owns it — a searcher without `payments:read` gets no order rows rather than a filtered-looking list.                                                                                                                           |
| Order detail workspace                                                                                                                                                      | **Done.** Two columns: what to do now and who to call are the side column and come FIRST in the DOM, so the phone number is the first thing after the heading on a 390px screen rather than below the line items.                                                                                                                                                   |
| Product editor: save-state and conflict handling                                                                                                                            | **Done.** A save carries the `updated_at` the form was loaded with; a mismatch is refused with a message naming what happened, not a silent overwrite. The "saved at" time is the server's, not the browser's.                                                                                                                                                      |
| Product editor: guided path                                                                                                                                                 | **Partly.** A section nav jumps to any of the seven sections; the editor is still one long form rather than a guided sequence.                                                                                                                                                                                                                                      |
| Product editor: type templates                                                                                                                                              | **Done.** Nine accessory types, each declaring which of six specification columns it asks for. A cable is asked for its length and connectors; a phone case is asked for neither, and never for a battery capacity. The type also decides which columns a submitted form may WRITE, so a crafted post cannot put a capacity on a case.                              |
| Duplicate-product workflow                                                                                                                                                  | **Done.** Copies the descriptions, brand, category, type, variants, specifications, prices, photographs and product-level compatibility into a DRAFT. Stock starts at zero and publication is never copied.                                                                                                                                                         |
| Shared patterns — `SectionPanel`, `MetricCard`, `AttentionItem`, `EmptyState`, `FormField`, `ErrorSummary`, `SaveBar`, `ConfirmationDialog`, `ActivityTimeline`, `Skeleton` | **Extracted.** `DetailDrawer` was not: nothing in the admin currently needs one, and a pattern with no caller is a guess.                                                                                                                                                                                                                                           |
| The ten §13 workflow tests                                                                                                                                                  | **Done — 18 tests.** The fixture creates unpaid orders holding real stock, one draft product with no price and no inventory row, and **no** paid order, verified payment or proof file. A seeded verified payment would be a fabricated record on the one screen whose entire job is to be trustworthy.                                                             |
| Media manager refinements                                                                                                                                                   | **Done.** Alt text is editable AFTER upload — the "senza descrizione" badge was previously unactionable — photos reorder with keyboard-reachable arrows that need no JavaScript, and deleting asks first in the markup, because confirm() fails open without a script. Three browser tests, using a PNG built byte by byte so the magic-byte sniffing is exercised. |
| Firefox and WebKit                                                                                                                                                          | **Run.** Firefox passes the admin spec. WebKit cannot hold the admin session over plain HTTP — the cookie is `__Host-` with `Secure` and WebKit does not treat `http://127.0.0.1` as trustworthy — so both engines run the public-page accessibility spec instead: 20 passed. Recorded rather than worked around; over HTTPS the cookie is accepted normally.       |
| Verification against the MariaDB runtime                                                                                                                                    | **Done — and it found four bugs.** `npm run test:e2e:mariadb` builds the Node server, rebuilds `zamzam_e2e` and runs `admin.spec.ts` against it: 29 passed. The first run found that no administrator could be created at all on MariaDB, plus three 500s. See [admin-visual-qa.md](admin-visual-qa.md).                                                            |

### What is still open, stated plainly

One thing:

**A guided path for a NEW product.** The section nav makes a long editor
navigable; it does not turn the first ten minutes with an empty product into a
sequence. The readiness panel names what is missing, which is most of the value,
but the form is still one form.

And two limits on the verification rather than on the admin: the MariaDB run
covers `admin.spec.ts` at one desktop viewport, and WebKit cannot hold an admin
session over plain HTTP.

None of these is a correctness defect: nothing above is a decorative button, a
fake save or a bypassed permission. They are unfinished refinement, and they
are listed here so that "polished" is not claimed over them.

### The compromises inside what IS done

Written here rather than left to be discovered.

|                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A charger has no wattage field.** There is no wattage column, and inventing one in a migration nobody asked for is a bigger decision than this pass should take. It goes in `connector` today ("USB-C 20 W").                                              |
| **`DetailDrawer` was not extracted.** Nothing in the admin needs one, and a pattern with no caller is a guess about the future.                                                                                                                              |
| **Duplicate skips variant-scoped compatibility.** A statement like "the 2 m version fits this phone" is re-asserted by a person, not by a copy. Product-level statements — the twenty-minute part — do come across.                                          |
| **Two admins duplicating one product in the same second race for the same `-C` suffix.** The loser's batch rolls back; nothing is written half-way. Not worth a lock at this scale.                                                                          |
| **Five workflow tests run on desktop only.** They write shared rows, and the two Playwright projects share one server and one database. Running them twice concurrently tests the scheduler, not the feature.                                                |
| **The primary photo cannot be reordered.** It is pinned first, because every consumer sorts `is_primary DESC, sort_order`. Giving it arrows produced a control that swapped two numbers and changed nothing, which looks exactly like a control that worked. |
| **No image derivatives.** One 900×900 file serves a 170px card and a 560px product image — worth roughly 470 KB on a phone, and blocked on a decision nobody has been asked for. See [hostinger/media-optimisation.md](hostinger/media-optimisation.md) §5.  |
