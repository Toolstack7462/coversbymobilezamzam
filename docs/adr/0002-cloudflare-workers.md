# ADR 0002 — Cloudflare Workers as the runtime

**Status:** Accepted · 2026-08-30

## Context

Needed: SSR for catalogue pages, a relational database, object storage,
scheduled jobs, and a free tier that survives a small Italian retailer's traffic.
The audience is largely mobile, in Italy, often on cellular.

## Decision

Cloudflare Workers, with React Router v8 in framework mode via
`@cloudflare/vite-plugin`, D1 for data, R2 for objects, and Cron Triggers for
scheduled work.

## Alternatives considered

**Vercel + Postgres.** Excellent DX. Rejected: the database is a paid add-on
almost immediately, and the free tier's limits arrive quickly. Cost was a stated
constraint.

**VPS with Node and Postgres.** Full control, roughly €5/month. Rejected: it is
not free, and it makes the merchant responsible for OS patching, TLS renewal,
backups and monitoring. That burden lands on a shop with no ops capability.

**Static site plus serverless functions.** Rejected: the catalogue needs
server-rendered, database-backed pages.

**Deno Deploy / Netlify.** Comparable, but neither bundles a relational database
and object storage into one free tier with one deployment and one binding model.

## Consequences

**Good.** Free tier genuinely covers this workload. Edge execution puts SSR close
to Italian users. D1, R2, Cron and secrets are one platform, one config file, one
`wrangler deploy`. No servers to patch.

**Bad, and worth stating plainly.** The Workers runtime is not Node: no
filesystem, limited native modules, CPU-time limits per request. D1 is SQLite
with its own constraints — no `RETURNING` in every position, limited concurrent
write throughput, size limits. Vendor lock-in is real; D1 is not portable
Postgres, and the bindings model is Cloudflare-specific.

**Mitigations.** The domain layer imports no Cloudflare API at all, so business
logic is portable even though infrastructure is not. Repositories sit behind
ports. Heavy work (imports, exports) is chunked to stay inside CPU limits.
Integration tests run in the real workerd runtime, so a Node-ism cannot pass
tests and fail in production.

## Rollback

Infrastructure adapters would be rewritten against a Node runtime and Postgres;
domain and application layers would not change. D1 exports to SQL, and SQLite to
Postgres is a well-trodden migration. Estimated as significant but bounded work,
which is the point of the layering.
