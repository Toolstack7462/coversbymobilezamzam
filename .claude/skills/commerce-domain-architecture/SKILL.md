---
name: commerce-domain-architecture
description: Layer boundaries for this codebase. Use when adding a business rule, a use case, a repository, or when deciding where code belongs.
---

# Commerce domain architecture

## The one test

**If a domain test needs a Cloudflare binding, the code is in the wrong layer.**

## Where things go

| Adding | Goes in |
|---|---|
| A calculation over plain data | `app/domain/<area>/` |
| An orchestration that touches storage | `app/application/commands/` or `queries/` |
| An interface the app needs from outside | `app/application/ports/` |
| A D1 / R2 / email implementation | `app/infrastructure/` |
| A loader, action or route | `app/routes/` |
| Markup and styling | `app/components/` |

## Domain layer rules

- Imports **only** TypeScript and Zod. No React, no Drizzle, no bindings.
- Pure functions and plain types. No I/O, no `fetch`, no `new Date()`.
- Time comes from the `Clock` port, ids from `IdGenerator`.
- Exhaustive `switch` over union types; no default case that hides a new variant.

## Application layer rules

- One use case per file, one exported function.
- Takes ports as arguments. Does not construct adapters.
- Validates input with Zod at entry.
- Returns a typed result, never a `Response`.

## Route rules

- Loaders and actions call use cases. They never import a repository or a Drizzle
  table.
- Authorisation is checked here **and** enforced in the use case.
- Never trust a submitted price, total, stock figure or role.

## Red flags in review

- A hex colour outside `tokens.css`
- A `db.select()` inside `app/components/`
- The same rule implemented in two places
- A domain file importing anything from `infrastructure/`
- A rule that only exists in a React component
