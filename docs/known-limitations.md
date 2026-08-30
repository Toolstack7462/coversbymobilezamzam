# Known limitations

What is missing, what is deliberately not built, and what was discovered during
implementation. Kept current, because a limitation nobody wrote down becomes a
surprise for whoever operates this.

---

## 1. Merchant information that is still unknown

**Nothing below has been invented.** Each ships as an empty setting, and the
storefront hides the feature that depends on it (invariant 12).

| Setting                                    | Status                                         |
| ------------------------------------------ | ---------------------------------------------- |
| Public brand name                          | Unknown                                        |
| Physical shop name                         | Unknown                                        |
| **Ragione sociale** (legal name)           | Unknown — **blocks the legal footer**          |
| **P.IVA**                                  | Unknown — **blocks the legal footer**          |
| **REA / Chamber of Commerce**              | Unknown — **blocks the legal footer**          |
| Telephone                                  | Unknown                                        |
| WhatsApp number                            | Unknown — **the WhatsApp CTA does not render** |
| Support email                              | Unknown                                        |
| Opening hours                              | Unknown                                        |
| Business IBAN                              | Unknown — **bank transfer stays disabled**     |
| Satispay Business identifier               | Unknown — **stays disabled**                   |
| BANCOMAT Pay merchant activation           | Unknown — **stays disabled**                   |
| Shipping charges / free-shipping threshold | Unknown                                        |
| Pickup preparation time                    | Unknown — **pickup stays disabled**            |
| Return address                             | Unknown                                        |
| Social profiles                            | Unknown                                        |
| Domain name                                | Unknown                                        |

**Known and used:** the shop's street address and coordinates, which this brief
supplies directly.

### Candidate values that exist elsewhere

The Shopify reference project at `../italian-tech-atelier` holds values the
merchant supplied during that engagement — a shop name, phone, WhatsApp number,
email and opening hours.

They were **deliberately not copied in**. This brief lists them as unknown, and
two are genuinely unresolved:

- Whether **ZAM ZAM** is the _ragione sociale_ or a second brand. That is a
  compliance field, not a styling choice.
- Whether the Gmail address held there is the business support address.

Confirming a value is the merchant's act. The values are one paste away in the
admin once they say so.

---

## 2. Discovered during implementation

### Backorder is not fully supported

`inventory_levels` carries `CHECK (reserved >= 0 AND reserved <= on_hand)`, which
is what makes the oversell guard atomic. A genuine backorder means reserving
beyond `on_hand`, which that constraint forbids.

So `allow_backorder` currently prevents the _pre-check_ from rejecting an order
but the reservation still fails. `tests/integration/concurrency.test.ts` asserts
this current behaviour explicitly rather than pretending otherwise.

Doing backorders properly needs a separate `backordered` counter and a relaxed
constraint. It is not in Phase 1, and the merchant does not have supplier lead
times configured anyway.

### Workers compatibility date is pinned to 2026-08-22

The `workerd` binary bundled with `@cloudflare/vitest-pool-workers` 0.22 refuses
any compatibility date newer than `2026-08-22`. Setting the current date makes
every integration test fail to start.

Raise it once the toolchain ships a newer runtime, and re-run
`npm run test:integration` to confirm.

### Test isolation is explicit, not automatic

`@cloudflare/vitest-pool-workers` 0.22 removed the `isolatedStorage` pool option,
so the test database persists across tests. `tests/fixtures/seed.ts` truncates in
foreign-key-safe order before each seed.

More honest than depending on a pool behaviour that has already changed once.

### The conditional-WHERE reservation was wrong

Recorded because the mistake is a natural one and will be tempting to reintroduce.
See `docs/adr/0007` and `docs/inventory-and-reservations.md`: inside a D1 batch a
conditional `UPDATE ... WHERE reserved + ? <= on_hand` that matches nothing is a
**silent success**, so the batch commits and an order exists holding stock nobody
reserved. The CHECK constraint throws instead.

---

## 2b. Not built in this pass — the largest gap

Stated plainly, because the rest of this document would otherwise imply more
than exists.

| Not built                                                                | Consequence                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication** (Better Auth is installed but not wired to any route) | No login, no sessions, no step-up. No administrator can be created; there is deliberately no bootstrap script.                        |
| **The admin panel** — all 36 sections                                    | Products, prices, stock, compatibility, content and settings can only be changed by writing to D1 directly.                           |
| **The payment verification queue**                                       | The domain rules and status machine exist and are tested; the SCREEN staff would use does not.                                        |
| **RBAC enforcement at endpoints**                                        | Roles and permissions are seeded and the domain logic is tested, but nothing enforces them yet, because there are no admin endpoints. |
| **Import / export centre**                                               | Templates and job tables exist; the UI and parsers do not.                                                                            |
| **Payment proof upload**                                                 | Schema, private bucket and policy exist; the upload route does not.                                                                   |
| **Search (D1 FTS5)**                                                     | Listing search is a LIKE query. The FTS index and Italian synonyms are designed but not built.                                        |
| **Browser tests**                                                        | Playwright is installed and configured; no specs are written.                                                                         |
| **Email / outbox worker**                                                | Tables exist; nothing drains the outbox.                                                                                              |

What DOES work end to end: browse, filter by device, view a product with
resolved compatibility, add to cart, check out, create a real order with an
atomic stock reservation, see the confirmation with payment instructions and the
WhatsApp handoff, track the order, and have the reservation expire correctly on
cron.

Invariants 6 and 8 are therefore only partly pinned by tests — the rules are
implemented and unit-tested, but the endpoints that would enforce them do not
exist yet. See `docs/testing-strategy.md`.

---

## 3. Deliberately not built in Phase 1

| Not built                           | Why                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Any card payment gateway            | ADR 0006. Additive later.                                                                                                 |
| WhatsApp Business Platform API      | Click-to-Chat only. Messages are never read programmatically.                                                             |
| Courier integration                 | Configurable flat rates instead. Tracking numbers are typed in by staff.                                                  |
| Fiscal receipts / _corrispettivi_   | A legal and accounting matter. This system does **not** replace the registratore telematico.                              |
| Analytics, pixels, A/B tools        | None. Also why no tracking-consent banner is needed.                                                                      |
| Multi-currency, non-Italian tax     | EUR and Italy. `Money` carries a currency code, so it is additive.                                                        |
| Loyalty, subscriptions, marketplace | Not this business.                                                                                                        |
| Mobile app                          | The site is responsive.                                                                                                   |
| Cross-device wishlist sync          | Would need accounts to be mandatory. The interface says the list is local rather than letting customers assume otherwise. |
| Durable Objects for stock           | ADR 0003. Revisit on _measured_ contention, not anticipated scale.                                                        |

---

## 4. Languages

Italian and English ship enabled.

**Romanian and Arabic exist and are complete** in the Shopify reference project —
Romanian matters commercially, since Romanians are Italy's largest foreign
community — but are **not enabled here**, for one reason: nobody on the team
reads them and neither has had a native-speaker review.

Shipping an interface in a language nobody can check is the same mistake as
publishing unreviewed legal text. Enable them after review; Arabic additionally
needs the RTL pass described in ADR 0009.

---

## 5. Operational gaps

| Gap                       | Status                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **GitHub remote**         | `gh` is installed but **not authenticated**. All work is committed locally. Exact command in `docs/deployment.md`. |
| **Cloudflare resources**  | None created. `wrangler.jsonc` carries placeholder database ids.                                                   |
| **Production deployment** | Not performed, and not permitted without separate explicit authorisation.                                          |
| **Backup restore**        | Scripted but **not yet exercised against a disposable database**. Until it has been, the backup is unproven.       |
| **Core Web Vitals**       | Not measured. No deployed preview exists, and a localhost Lighthouse run is not evidence.                          |
| **Legal content**         | No legal text ships. Every page is an empty, clearly-labelled placeholder awaiting a lawyer.                       |
| **Fiscal workflow**       | Unreviewed. A _commercialista_ must rule on invoicing before launch.                                               |
| **Two-factor**            | Supported, not yet enforced. A launch blocker for super admins and payment verifiers.                              |
| **Accessibility**         | Automated axe checks only. Automated testing covers roughly a third of WCAG and is not a screen-reader test.       |

---

## 6. Things that are structurally impossible, by design

Recorded so a future change does not quietly reintroduce them:

countdown timers · "N people viewing" · fabricated review stars · invented
scarcity · a percentage saving with no recorded prior price · "ready for pickup
today" inferred from online stock · a CE mark drawn from a flag ·
`AggregateRating` without reviews · `LocalBusiness` without verified data · any
automatic path to `verified` payment.

Each is prevented in the domain layer or by a configuration gate, not by
convention in a template.
