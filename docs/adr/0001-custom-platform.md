# ADR 0001 — Build a custom platform rather than adopt one

**Status:** Accepted · 2026-08-30

## Context

The merchant needs an online store alongside their shop in Sulmona. A Shopify
Online Store 2.0 theme was already built for them (`../italian-tech-atelier`) and
works.

The requirement changed: own the storefront, the admin, the schema, the product,
price, inventory and order data, the content, the deployment configuration and
the git history — with **zero ecommerce-platform subscription**.

## Decision

Build a custom modular monolith. **Do not use** Shopify, Odoo, WooCommerce,
WordPress, Magento, Medusa, Saleor or any paid platform.

## Alternatives considered

**Keep the Shopify theme.** Fastest path, and it is genuinely good. Rejected: the
merchant does not own the platform, the data lives in Shopify, and there is a
monthly fee plus transaction fees. Every requirement above fails.

**WooCommerce or Magento self-hosted.** Zero licence cost and ownership of the
data. Rejected: both need a PHP host and a MySQL server — so not free — and both
carry a large plugin attack surface that a shop with no ops staff has to patch
forever. WordPress in particular is a maintenance commitment, not a one-off.

**Medusa or Saleor.** Excellent open-source engines. Rejected as heavier than the
problem: both expect a persistent Node or Python service plus Postgres and Redis,
which is neither free-tier nor operationally free. Both also impose their own
domain model, and the two hard requirements here — compatibility resolution and
human-verified manual payment — sit awkwardly inside someone else's order engine.

**Headless Shopify with a custom front end.** Rejected: still a subscription,
still not ownership.

## Consequences

**Good.** Complete ownership. No subscription. No transaction fee. The
compatibility model and manual-payment workflow are first-class rather than
worked around. Free-tier hosting is realistic.

**Bad.** Everything is now this project's responsibility: security, PCI-adjacent
questions if a gateway is added, uptime, backups, accessibility, and the many
edge cases a mature platform has already met. There is no app store. This is a
larger build and a permanent maintenance commitment.

**Mitigations.** Invariants with tests. Documented threat model. Forward-only
migrations. `npm run verify` as the single gate. Written runbooks, because the
person operating this will not be the person who wrote it.

## Rollback

The Shopify theme still exists, untouched, and could be republished. Beyond that
point, exporting catalogue, customers and orders to a platform's import format is
possible but not trivial; `docs/import-export.md` keeps exports first-class
partly for this reason.
