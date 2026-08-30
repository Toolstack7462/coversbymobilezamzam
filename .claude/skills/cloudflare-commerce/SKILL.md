---
name: cloudflare-commerce
description: Cloudflare Workers, D1, R2 and Cron patterns for this project. Use when writing a repository, a scheduled job, or anything touching bindings.
---

# Cloudflare commerce patterns

## D1

**Never read-then-write for anything contended.** Put the condition in the SQL:

    UPDATE inventory_levels
       SET reserved = reserved + ?
     WHERE variant_id = ? AND location_id = ?
       AND reserved + ? <= on_hand

Zero rows affected means it did not happen. Check `meta.changes`.

**Use batches for anything atomic.** `db.batch([...])` is all-or-nothing. Order
creation is one batch. A partially created order that holds stock is worse than
no order.

- Prepared statements only. Never concatenate SQL.
- Money is `integer` minor units. Timestamps are `integer` epoch ms, UTC.
- Booleans are `integer` 0/1.
- Check `EXPLAIN QUERY PLAN` for any query on a table that grows.
- Chunk bulk work. Workers have CPU limits per request.

## R2

- `MEDIA` is public. `PRIVATE_FILES` is private and has **no public URL**.
- Private reads go through an authenticated route that checks permission,
  issues a short-lived signed read, and logs the access.
- Object keys are random. The uploaded filename is never trusted.
- Validate MIME, extension **and magic bytes**. The first two are attacker
  controlled.

## Cron

- Expressions are **UTC**. Say so in a comment next to every one.
- Handlers must be idempotent — runs overlap.
- Claim work conditionally before acting on it.
- Re-check preconditions after claiming. State can change between the query and
  the action.
- Record every run in `scheduled_job_runs`.

## Bindings

- Bindings reach the domain layer only through a port. Never import `env` in
  `app/domain/`.
- Secrets come from `env`, never from a committed file.
- Never log a binding value.

## workerd is not Node

No filesystem. No native modules. Integration tests run in the real runtime for
exactly this reason — a Node-ism must fail in CI, not in production.
