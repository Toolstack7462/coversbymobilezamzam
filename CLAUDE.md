# CLAUDE.md — operating contract

Rules for anyone, human or agent, changing this repository. These override
convenience, habit and default framework advice.

This file is the **contract**. The reasoning behind each rule lives in `docs/`;
duplicating it here would guarantee the two drift apart.

---

## 1. What this is

A self-owned ecommerce platform for an Italian mobile-phone-accessories retailer
with an online store and a physical shop in Sulmona (AQ).

The merchant owns the source, the schema, the data, the deployment configuration
and the git history. There is no ecommerce platform underneath this and no
platform subscription.

**Stack** — React Router v8 (framework mode, SSR) · React 19 · TypeScript strict ·
Vite · Cloudflare Workers · D1 · R2 · Drizzle ORM · Better Auth · Zod · Turnstile.

**Not this, ever:** Shopify, Odoo, WooCommerce, WordPress, Magento, Medusa,
Saleor, or any paid ecommerce platform. No Tailwind or comparable CSS framework.
No component library. No analytics or marketing tracker. **No payment gateway in
Phase 1** — no Stripe, PayPal, card form, payment SDK or payment webhook.

---

## 2. Layer boundaries

    domain  ←  application  ←  infrastructure
                    ↑               ↑
                  routes  →  components

**The domain layer imports nothing but TypeScript and Zod.** No React, no
Cloudflare binding, no D1, no R2, no Resend, no route module. If a domain rule
cannot be unit-tested in plain Node, it is in the wrong place.

The application layer defines **ports** (interfaces). Infrastructure implements
them. Routes call the application layer, never a repository directly.

| Never                                 | Instead                          |
| ------------------------------------- | -------------------------------- |
| A React component querying D1         | A loader calling a use case      |
| A business rule inside a component    | The domain layer                 |
| The same rule in admin and storefront | One implementation, both call it |
| A route importing a Drizzle table     | A repository behind a port       |

**One authoritative implementation per rule.** A price rule that exists in both
the cart and the order builder will diverge, and the version the customer saw
will not be the version they are charged.

---

## 3. Invariants

The full list with rationale is `docs/invariants.md`. These are not style
preferences; each is enforced by a test.

1. **Money** is integer minor units with a currency code. `3990` is €39,90.
   Never a float. `parseFloat` is an ESLint error.
2. **Server authority.** Price, discount, VAT, shipping, total, stock, payment
   status, role, permission, compatibility and location are recomputed
   server-side. The browser is an input, never a source.
3. **Compatibility** comes from structured records only — never inferred from a
   title, tag, category, URL, brand or collection. `universal` never resolves to
   exact fit. A missing record means _unknown_, not compatible.
4. **Inventory** changes only through a movement or reservation record. No silent
   stock writes; every manual adjustment carries a reason and a user.
5. **Order items snapshot** name, SKU, variant, unit price, quantity, discount,
   tax, compatibility, image and device context at creation. Editing a product
   never rewrites history.
6. **Payment.** A WhatsApp click, an uploaded screenshot, or a customer's word
   can never mark an order paid. Only authorised staff, after checking the actual
   bank or merchant app.
7. **Status machines** for order, payment, reservation and fulfilment are
   separate, typed, and validated on transition. No arbitrary strings.
8. **Audit** every sensitive mutation: price, stock, payment verification, IBAN,
   cancellation, refund, role, compatibility verification, archive.
9. **Migrations** are forward-only files in git. `drizzle-kit push` is never run
   against a deployed database.
10. **Time** is stored UTC, displayed `Europe/Rome`. Cron is UTC. `new Date()` is
    an ESLint error outside infrastructure — use the Clock port.
11. **No fabricated commerce claims.** See §7.
12. **Configuration gates.** A feature whose merchant data is missing stays off
    and renders nothing.
13. **Archive, not erase**, for anything a historical transaction references.
14. **Idempotency** on any mutation that might be retried.

---

## 4. Merchant data

**Never invent merchant information.** Not a phone number, not an opening time,
not a shipping price, not a legal name.

Unknown values ship as **empty settings**, and the storefront **hides the feature
that depends on them**. A blank field renders nothing — never `[PHONE]`, never
`[VAT NUMBER]`, never a plausible-looking guess.

Known and usable today: the shop's street address and coordinates. Everything
else in `docs/known-limitations.md` is unconfirmed and must stay empty until the
merchant states it.

An invented opening time sends a real person to a closed door. That is the
standard being applied.

---

## 5. Design system

Tokens live in `app/styles/tokens.css` and are **the only place literal colours
are allowed**. A hex value anywhere else is a review failure.

    --color-ink:        #0B1220     --color-background: #F7F8F5
    --color-primary:    #2457FF     --color-surface:    #FFFFFF
    --color-primary-hover: #1743D3  --color-text-secondary: #667085
    --color-accent:     #B9F227     --color-border:     #DDE3EA
    --color-success:    #15845A     --color-danger:     #D92D20
    --color-warning:    #B54708

**Fill tokens are not text tokens.** `--color-success` on porcelain measures
4.40:1 and `--color-danger` on its own tint 4.22:1 — both below AA. Use
`--color-success-text` / `--color-danger-text` / `--color-warning-text` wherever
the colour carries text. This was measured, not guessed.

**Lime (`--color-accent`) is device-context only**: selected device, verified
compatibility, selected compatibility filter. It is never a button colour, never
a generic success, never a focus ring.

Rough balance: 70% porcelain/white · 20% navy · 8% cobalt · 2% lime.

- Type: Manrope (headings 600/700/800), Inter (body/UI 400–700). Tabular numerals
  for prices, quantities, order numbers, inventory.
- Spacing: 8-point scale. Interactive targets **≥44×44px**. Controls 48–52px tall.
- Radii: control 10px · card 12–14px · editorial 18px.
- Status must never be carried by colour alone — always text plus icon or shape.
- SVG icons from one set. **Emoji are not interface icons.**
- Respect `prefers-reduced-motion`. Animate `transform` and `opacity` only.

---

## 6. Localisation

Italian is the default; English is secondary. **No user-visible string is
hardcoded in a component** — it lives in `app/locales/`.

Italian tone: concise, helpful, professional, reassuring. Not formal, not
manipulative. Italian labels run longer than English; test them at 390px.

Merchant content (product names, descriptions, page copy) is translated through
the admin panel, not through locale files.

---

## 7. Prohibited

Never fabricate, and never build a surface capable of fabricating:

reviews · ratings · sales counts · bestseller status · discounts · previous
prices · scarcity · countdown timers · "N people viewing" · delivery promises ·
pickup readiness · certifications · CE marks · compatibility · warranties ·
customer numbers.

A percentage saving renders **only** from a genuine recorded prior price. A
strikethrough alone shows no percentage. Low stock requires real tracked
inventory. `AggregateRating` requires real reviews. `LocalBusiness` requires
verified merchant data.

These are not stylistic choices — under the Unfair Commercial Practices Directive
as amended by (EU) 2019/2161 several are unlawful.

---

## 8. Security

- Validate every input with **Zod at the boundary**. Parse, do not trust.
- Prepared statements only. Never build SQL by string concatenation.
- Authorisation is enforced **server-side on every endpoint**. Hiding a menu item
  is not authorisation.
- Step-up authentication for: IBAN, beneficiary, merchant payment identifiers,
  payment-verification rules, role changes.
- Payment proofs go to the **private** R2 bucket, random keys, authenticated
  short-lived reads, access logged. Never a public URL.
- CSV exports neutralise cells starting `=` `+` `-` `@`.
- Public order tracking uses a random non-enumerable token, never a sequential id.
- **Never log** passwords, session tokens, full IBAN, proof contents, or secrets.
- Never commit `.env`, `.dev.vars`, keys, real customer data, proofs or DB dumps.

---

## 9. Change safety

A change is **not done** until its companions are done. Full policy:
`docs/change-management.md`.

| Change                  | Also required                                                                    |
| ----------------------- | -------------------------------------------------------------------------------- |
| Schema                  | migration · schema types · data dictionary · indexes reviewed · integration test |
| API                     | request/response schema · validation · tests · client compatibility              |
| Status machine          | transition map · invalid-transition tests · admin UI · docs                      |
| Price or inventory rule | domain tests · order-snapshot check · audit-log check                            |
| Design system           | tokens · affected screens reviewed · contrast · mobile                           |

Prefer additive migrations, feature flags, deprecation and backfills over
breaking changes.

---

## 10. Performance

LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1. Initial storefront JS < 160KB gzip, CSS <
45KB gzip, enforced by `npm run budgets`.

SSR, route-level splitting, responsive images with reserved dimensions, lazy
loading below the fold, indexed queries, pagination. No autoplay video, no
carousel library, no whole-catalogue payload.

**Core Web Vitals are not claimed until measured against a deployed preview.**

---

## 11. Verification

    npm run verify

Runs format check · lint · typecheck · locale parity · migration validation ·
unit · integration · security · build · budgets · secret scan.

**Nothing is described as verified, tested, committed, pushed or deployed unless
the corresponding command actually succeeded.** Report real output. A failing
test is reported as a failing test.

---

## 12. Git and deployment

- Branch `main`. Never force push. Never rewrite shared history.
- Never commit secrets. Never push failing code.
- `git push` and Cloudflare deployment are **separate actions**.
- **Never deploy to production automatically.** It requires separate explicit
  authorisation, every time.
- Never create production Cloudflare resources automatically.
