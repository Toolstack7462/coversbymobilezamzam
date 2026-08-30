---
name: ecommerce-security
description: Security checklist for this codebase. Use when adding an endpoint, a form, an upload, an export, or anything touching authorisation.
---

# Ecommerce security

## What an attacker wants, in order

1. **Redirect payments** — change the IBAN and every future transfer is theirs.
2. **Get goods without paying** — mark paid, or tamper a price.
3. **Harvest customer data.**
4. **Vandalise the catalogue.**

Prioritise accordingly.

## Every endpoint

- Zod-validate input at the boundary. **Parse, do not trust.**
- Check authorisation **server-side**. Hiding a menu item is not authorisation.
- Scope every lookup by ownership or permission **in the query**, not after
  fetching.
- Mutations are never `GET`. Check the origin.
- Never accept a price, total, stock figure, role or status from the client.
  Ignore those fields rather than validating them.

## Step-up required

IBAN, beneficiary, merchant identifiers, payment-verification rules, role
changes, payment verification.

## Uploads

Private bucket · presigned short-lived · order-scoped authz · MIME + extension +
**magic bytes** · size cap · random key · server finalisation · logged.

## Exports

Neutralise cells starting `=` `+` `-` `@`. Otherwise a supplier-chosen product
name becomes a formula that runs when the merchant opens the file.

## Never log

Passwords · tokens · session ids · full IBAN · proof contents · email bodies ·
`SETTINGS_ENCRYPTION_KEY` · `BETTER_AUTH_SECRET`.

## Public identifiers

Order numbers are partly guessable (the date is in them), so they never authorise
access. Order tracking uses a separate 32-character random token and is rate
limited.

## Password reset

Identical response whether or not the account exists. Otherwise the form is an
account-existence oracle.
