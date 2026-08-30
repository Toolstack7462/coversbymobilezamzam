# Italian Tech Atelier — Commerce

A self-owned ecommerce platform for a mobile-phone-accessories retailer in
Sulmona (AQ), Italy. Online store and physical shop, one inventory.

**Internal project name.** It is not the public brand name, which has not yet
been supplied.

---

## What this is

React Router v8 · React 19 · TypeScript strict · Vite · Cloudflare Workers · D1 ·
R2 · Drizzle ORM · Better Auth · Zod.

The merchant owns the source, the admin, the schema, the data, the deployment
configuration and the git history. There is no ecommerce platform underneath and
no subscription.

**Phase 1 takes no payments online.** The site creates structured orders,
reserves stock, and hands the customer to a human to settle payment by SEPA
transfer, Satispay, or in store. Only authorised staff may mark an order paid,
after checking the real account. See `docs/adr/0006-manual-payments.md`.

---

## Quick start

    npm install
    cp .dev.vars.example .dev.vars     # fill in the required values
    npm run db:migrate:local
    npm run db:seed
    npm run dev

Then visit **/admin/installazione** to create the first administrator. That
route is self-closing: it works only while no staff account exists. There is no
default account and no public admin registration.

## Commands

| Command                    | Does                                          |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Local dev server in the Workers runtime       |
| `npm run build`            | Production build                              |
| `npm run typecheck`        | Generate types, then `tsc --noEmit`           |
| `npm run lint`             | ESLint, zero warnings tolerated               |
| `npm run test:unit`        | Domain tests, plain Node                      |
| `npm run test:integration` | Real workerd, real D1, real migrations        |
| `npm run test:security`    | Authorisation, tampering, injection           |
| `npm run test:e2e`         | Playwright                                    |
| `npm run test:a11y`        | Playwright + axe                              |
| `npm run db:generate`      | Generate a migration from the schema          |
| `npm run db:migrate:local` | Apply migrations locally                      |
| `npm run backup`           | Export the database                           |
| `npm run restore:test`     | Restore into a disposable database and verify |
| **`npm run verify`**       | **Everything. The only gate that counts.**    |

## Documentation

Start with `CLAUDE.md` — the operating contract — then:

| Read                         | For                                                   |
| ---------------------------- | ----------------------------------------------------- |
| `docs/architecture.md`       | How the layers fit                                    |
| `docs/invariants.md`         | The fourteen rules that must hold                     |
| `docs/adr/`                  | Why each major choice was made, and what was rejected |
| `docs/merchant-guide.md`     | Running the shop, no code                             |
| `docs/operations-runbook.md` | When something is wrong                               |
| `docs/launch-checklist.md`   | What must be true before going live                   |
| `docs/known-limitations.md`  | What is missing and what is not built                 |

## Status

**READY FOR MERCHANT REVIEW — DO NOT LAUNCH.**

Merchant data, legal review, fiscal review, a tested restore and measured
production performance are all outstanding. See `docs/launch-checklist.md`.
