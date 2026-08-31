# The setup centre

`/admin/configurazione` — sixteen steps that answer one question: **what is
still missing before this shop can sell?**

---

## Every step is computed. Nothing is stored.

There is no `setup_completed` column, and no per-step boolean. Each step is
derived from a query on every load.

That is the whole design, and it is worth being clear about why, because a
stored boolean is easier and would be wrong:

> A checkbox someone ticked is a **claim**. A query is **evidence**.

If the merchant deletes their only payment method six months from now, a stored
`true` would sit there saying the shop is ready to take money when it is not.
The computed version goes back to incomplete on its own, the same day, without
anyone remembering to invalidate anything.

`tests/unit/setup-steps.test.ts` asserts exactly this: configure a payment
method, remove it, and the step reverts.

### The shape

`computeSetupSteps(snapshot)` is a pure function over a `SetupSnapshot` — a
plain object of counts and settings. The route gathers the snapshot in one SQL
pass (`loadSetupSnapshot`) and the domain function never touches a database. So
the rules are unit-testable without one, and the queries stay in a single place.

---

## Blocking versus recommended

Two severities, and the distinction is load-bearing:

- **`blocking`** — the shop genuinely cannot trade correctly without it. No
  payment method, no price, no legal identity.
- **`recommended`** — real, but survivable. No verified backup, no test order.

`readyToTrade` is computed from blocking steps **only**. A shop can open without
a verified backup; it cannot open without a way to be paid.

Marking everything blocking is the same as marking nothing blocking, because the
merchant stops believing the label. A test asserts both severities are actually
present.

---

## The sixteen steps

| Step                     | Severity    | Derived from                                 |
| ------------------------ | ----------- | -------------------------------------------- |
| `brand_identity`         | blocking    | brand name or shop name set                  |
| `legal_identity`         | blocking    | ragione sociale **and** P.IVA **and** REA    |
| `store_details`          | recommended | address complete and opening hours set       |
| `contact_channels`       | blocking    | WhatsApp, phone or email set                 |
| `admin_totp`             | blocking    | no privileged account without a verified 2FA |
| `first_product`          | blocking    | at least one product                         |
| `product_image`          | recommended | no product without an image                  |
| `product_price`          | blocking    | no product without a price                   |
| `inventory`              | blocking    | every variant has a stock row                |
| `compatibility_verified` | blocking    | records exist and no unverified `exact_fit`  |
| `payment_method`         | blocking    | at least one active payment method           |
| `delivery_method`        | blocking    | shipping **or** pickup enabled               |
| `legal_documents`        | blocking    | eleven published legal documents             |
| `test_order`             | recommended | at least one order exists                    |
| `backup_restore`         | recommended | a restore verified within 30 days            |
| `preview_deployment`     | recommended | a preview deployment recorded                |

Two of these deserve a note:

**`legal_identity` is all-or-nothing.** Two of three is not compliance — a
partial trader-identification block is arguably worse than none, because it
looks like compliance without being it (D.Lgs. 70/2003).

**`backup_restore` expires after thirty days.** A restore verified 45 days ago
is not evidence about today's backup. This step going back to incomplete on its
own is the feature, not a bug.

---

## Every incomplete step says why, and links to the fix

A step that says "incomplete" and nothing else is a dead end for someone who is
not technical. So each carries a `reason` written in the merchant's words, and
an `href` to the exact screen where it is fixed — usually a filtered view, such
as `/admin/prodotti?vista=senza-prezzo`, never a section root.

The reasons adapt to the data rather than being generic:

- With zero products, the image step says "add a product first" rather than
  "0 products without images", which would be nonsense.
- With records present but unverified, the compatibility step reports the count
  and explains that unverified exact-fit claims are what generate returns.

A test asserts every incomplete step has both a non-empty reason and a link
under `/admin`. `tests/unit/deep-links.test.ts` separately asserts those links
resolve to saved views that actually exist.

---

## The `attention` status

A third status sits between complete and incomplete: **`attention`** means the
data exists but is wrong in a way that will cause a problem. Twelve
compatibility records of which three claim an unverified exact fit is a
different situation from having no compatibility data at all, and it is the one
that causes returns and bad reviews.

---

## Relationship to the action centre

The dashboard's action centre includes a single `setup_incomplete` item carrying
the count of open blocking steps, linking here. It does not repeat the sixteen
steps: the dashboard answers "what needs me today", and this screen answers
"what is missing before launch". Duplicating the list in both would make the
dashboard a second, worse copy of this page.

---

## Not covered here

The setup centre reports on **configuration**, not on legality or correctness.
It cannot tell whether the published legal documents are any good, whether the
P.IVA is the right one, or whether the compatibility data a human marked
"verified" was actually checked against a real phone.

`docs/launch-checklist.md` covers what a person still has to sign off, and it is
the document that decides whether this shop can open — not this screen.
