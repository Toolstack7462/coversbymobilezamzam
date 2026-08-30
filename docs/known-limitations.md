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

### Do NOT merge the Dependabot TypeScript 7 branch

Dependabot has opened `dependabot/npm_and_yarn/typescript-7.0.2` on the remote.
**Merging it breaks `npm run lint`.**

`typescript-eslint@8.68.0` declares `typescript: ">=4.8.4 <6.1.0"`. TypeScript
5.9.3 is pinned for that reason — it was verified at bootstrap, not guessed.

Revisit only when typescript-eslint publishes a release whose peer range admits
TypeScript 7. A green Dependabot badge is not evidence that an upgrade is safe.

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

## 2b. What is built, and what is still missing

Authentication and the admin panel now exist. This section is kept accurate
rather than aspirational.

### Built and working

| Area                           | State                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authentication**             | Better Auth over D1. Login, sessions, sign-out, rate limiting, `__Host-` cookies.                                                                |
| **First-run setup**            | `/admin/installazione`, self-closing once one administrator exists.                                                                              |
| **RBAC enforcement**           | `requireStaff()` on every admin loader AND action. Permissions read fresh per request, so a revoked role takes effect immediately.               |
| **Step-up authentication**     | Required and **consumed** for payment verification and payment-settings changes. Purpose-scoped: a step-up for one does not authorise the other. |
| **Payment verification queue** | The full workflow, with amount-mismatch refusal and duplicate-reference flagging.                                                                |
| **Orders**                     | List, filter, and status changes limited to what the state machine allows.                                                                       |
| **Inventory**                  | Levels plus adjustments that require a written reason and write the full ledger.                                                                 |
| **Products**                   | Publish, unpublish, archive. Price changes write `price_history`.                                                                                |
| **Settings**                   | All merchant settings, plus encrypted payment identifiers behind step-up.                                                                        |
| **Audit log**                  | Read-only, filterable. No delete, no edit.                                                                                                       |

### Still missing

| Not built                       | Consequence                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TOTP two-factor UI**          | Better Auth supports it and the table exists, but nothing surfaces enrolment. **This is a launch blocker** for administrators and payment verifiers. |
| **Staff management screen**     | Roles are granted by inserting a `user_roles` row by hand. There is no UI to add a colleague.                                                        |
| **Product and variant editors** | Products can be published, archived and repriced, but not created or edited in the admin.                                                            |
| **Compatibility matrix editor** | Records are readable and countable; entering them needs the import centre or direct SQL.                                                             |
| **Import / export centre**      | Templates and job tables exist; the UI and parsers do not.                                                                                           |
| **Payment proof upload**        | Schema, private bucket and policy exist; the upload route does not.                                                                                  |
| **Search (D1 FTS5)**            | Listing search is a LIKE query. The FTS index and Italian synonyms are designed, not built.                                                          |
| **Browser tests**               | Playwright is configured; no specs are written.                                                                                                      |
| **Email / outbox worker**       | Tables exist; nothing drains the outbox.                                                                                                             |
| **Returns and refunds UI**      | Schema and state machine exist; no screens.                                                                                                          |

What works end to end: browse, filter by device, add to cart, check out, create a
real order with an atomic reservation, receive payment instructions and the
WhatsApp handoff, track the order — and, on the staff side, sign in, verify the
payment against the real bank account, watch the stock hold convert to a sale,
and see the whole thing in the audit log.

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
