# ADR 0004 — R2 for media, split into public and private buckets

**Status:** Accepted · 2026-08-30

## Context

Two kinds of file, with opposite requirements:

- **Product media** — should be public, cached hard, served fast.
- **Payment proofs and exports** — personal and financial data, must never be
  publicly reachable, every access logged.

## Decision

R2, with **two separate buckets**: `MEDIA` (public) and `PRIVATE_FILES`
(private). Binary data never goes into D1.

Private objects have no public URL at all. Reads go through an authenticated
route that checks staff permission, issues a short-lived signed read, and logs
the access.

## Alternatives considered

**One bucket with a `private/` prefix.** Simpler config. **Rejected** — and this
is the important one. With a single bucket, "public" becomes a property of a path
convention. One misconfigured public domain, one wrong key, one refactor that
moves a prefix, and payment proofs are world-readable with no error and no
warning. Two buckets make it structural: the private bucket has no public
endpoint to leak through.

**Base64 images in D1.** Rejected: bloats the database, ruins backup size, and
blocks CDN caching.

**Cloudflare Images.** Good automatic transforms. Rejected for Phase 1: paid, and
resizing at upload time covers the need.

**Third-party (S3, Cloudinary).** Rejected: egress cost, another vendor, another
credential.

## Consequences

**Good.** No egress fees. Public media caches at the edge. Private files are
structurally unreachable without authorisation. Database stays small, so backups
stay quick.

**Bad.** Image variants are generated at upload rather than on demand, so
changing the size ladder means reprocessing. Two buckets to create and configure.
Deleting a product means cleaning objects too — an orphaned-object sweep is
needed.

**Mitigations.** Fixed size ladder (≈320 / 640 / 1200) covering the layouts in
use. Client-side resize and compression before upload, so a 12MP phone photo does
not travel. `scripts/verify/media-inventory.mjs` cross-checks `product_images`
against bucket contents in both directions.

## Rollback

The `MediaStorage` port has one R2 adapter. Swapping to S3 or Images is a new
adapter plus an object copy; no calling code changes.
