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
| `docs/admin-guide.md`        | Running the shop, no code                             |
| `docs/admin-user-flows.md`   | The jobs the shop does, screen by screen              |
| `docs/operations-runbook.md` | When something is wrong                               |
| `docs/launch-checklist.md`   | What must be true before going live                   |
| `docs/known-limitations.md`  | What is missing and what is not built                 |

Building on the admin:

| Read                                     | For                                     |
| ---------------------------------------- | --------------------------------------- |
| `docs/admin-information-architecture.md` | What goes where in the sidebar, and why |
| `docs/admin-design-system.md`            | The rules the interface is built from   |
| `docs/admin-table-patterns.md`           | Every list, and the URL state behind it |
| `docs/setup-centre.md`                   | The computed launch checklist           |

## Status

**READY FOR MERCHANT REVIEW — DO NOT LAUNCH.**

The software is feature-complete for Phase 1: a merchant can install the shop,
enrol in two-factor, add phones, products, photos and compatibility, import a
supplier's spreadsheet after reviewing exactly what it will change, take an
order, verify the payment against their own bank account, and hand off to
WhatsApp — with every step audited.

What is outstanding is not code:

- **The merchant's own data.** Brand name, P.IVA, REA, contacts, opening hours
  and payment details are all empty, deliberately. Nothing has been invented.
- **Legal and fiscal review.** The eleven required documents are not written,
  and this system will not generate them.
- **A tested backup restore.** A backup nobody has restored is not a backup.
- **A deployed preview.** Core Web Vitals, real-HTTPS cookie behaviour and the
  first-run flow against a real Cloudflare environment are all unmeasured;
  localhost is not evidence.

See `docs/launch-checklist.md` for the full gate, and
`docs/known-limitations.md` for what is deliberately not built.
