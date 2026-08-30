# ADR 0009 — Localisation: interface in files, content in the database

**Status:** Accepted · 2026-08-30

## Context

Italian is the primary language; English is secondary. Two very different kinds
of text need translating: interface strings written by developers, and product
and page content written by the merchant.

## Decision

**Interface strings** live in `app/locales/it.json` and `en.json`, in the
repository. **Merchant content** lives in D1 with sibling `*_translations`
tables, editable in the admin.

Italian is the default and the source of truth for interface copy. Locale parity
is enforced by `npm run locales:check`, which fails the build on a missing key.

Language is selected by URL prefix (`/en/…`), so a page has one canonical
address.

## Alternatives considered

**Everything in the database.** Rejected: interface strings would need an admin
screen nobody wants, they could not be reviewed in a pull request, and a typo
would be a production data edit rather than a commit.

**Everything in files.** Rejected: the merchant cannot edit a product description
by opening a JSON file and redeploying.

**Machine translation at request time.** Rejected: cost, latency, and it produces
wrong Italian in exactly the places that matter — legal text and compatibility
wording, where a mistranslation is a liability rather than an awkward phrase.

**Cookie- or header-based language with one URL.** Rejected: the same URL serving
different languages breaks caching and canonical SEO, and a shared link shows the
sender's language rather than the recipient's.

## Consequences

**Good.** Interface copy is reviewed like code. Merchant content is edited
without a developer. Missing keys break the build, not the customer's page.
Adding a language is a file plus admin translations — no schema change.

**Bad.** Two systems to think about. A partially translated product needs a
fallback policy. URL prefixing means route configuration and `hreflang`.

**Mitigations.** Explicit fallback: missing content falls back to Italian and is
flagged in the admin as untranslated, rather than rendering an empty field.
`hreflang` and canonical tags on every localised page.

## Romanian and Arabic

The Shopify reference project has complete Romanian and Arabic locale files.
Romanian matters here — Romanians are Italy's largest foreign community.

They are **not enabled in Phase 1**, for one reason: nobody on the team reads
them, and neither has had a native-speaker review. Shipping an interface in a
language nobody can check is the same mistake as publishing unreviewed legal
text. They are recorded in `docs/known-limitations.md` as ready to enable once
reviewed.

Arabic additionally needs RTL: a `dir` attribute plus CSS logical properties,
which the stylesheet already uses throughout, and six CLDR plural forms, which
the existing file already has.

## Rollback

Removing a language is deleting a locale file and a route prefix. No data loss:
merchant translations remain in the database.
