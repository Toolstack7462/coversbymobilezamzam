# Deployment runbook

How to ship a release to coversbymobile.com, and how to undo it.

---

## The one thing to know first

**Two pipelines are connected to this site. Only one of them works.**

|                               |                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| **SSH release + Passenger**   | What actually serves the site. Use this.                                                             |
| Hostinger Git auto-deployment | Fires on every push to `main`, builds, then fails at `ERROR: No output directory found after build`. |

The Git flow is a **static-site** pipeline: it runs `npm run build` and looks
for a directory of files to publish. An SSR application has no such directory —
the thing that serves the site is a **process**. Its failure is harmless
because it never touches `current`, which was confirmed again during the
2026-09-14 release: `main` was pushed, the Git deploy failed as usual, and the
live site kept serving without interruption.

**A green GitHub push is not a deployment.** Nothing reaches the site until
`hostinger:deploy` runs.

---

## Releasing

```sh
# Credentials come from the environment and are never stored in the repository.
#   HOSTINGER_SSH_HOST / _PORT / _USER / _PASSWORD  (or _KEY)

npm run hostinger:deploy -- --dry-run   # proves access and the docroot guard
npm run hostinger:deploy                # build, upload, install, switch, restart
```

What it does, in order: builds with `build:hostinger`, packs, uploads to
`releases/<timestamp>/`, runs `npm ci --omit=dev --ignore-scripts`, checks the
built server actually imports, moves the `current` symlink, touches
`tmp/restart.txt`, prunes to the last 3 releases.

It is atomic: the symlink moves only after a complete release is in place, so a
half-uploaded release can never be served.

**It never runs migrations.** That is `npm run hostinger:migrate`, deliberately
separate and deliberately manual. Do not run it because a script exists — only
when a release genuinely changes the schema.

### Then verify, always

```sh
curl -s https://coversbymobile.com/api/health
```

Check `commit` equals the SHA you intended and `dirty` is `false`. A green
build and a 200 on the homepage do not prove which code is running.

---

## Rolling back

```sh
npm run hostinger:deploy -- --rollback
```

A symlink move, not a rebuild — seconds, and the previous release is still on
disk. Three are kept.

This rolls back the **application only**. It does not touch the database, and
it must not: rolling a database back discards business data created since the
release. If a release requires a schema change to be undone, that is a separate,
reviewed operation.

---

## Configuration

```sh
npm run hostinger:configure           # writes .htaccess: Passenger + SetEnv
npm run hostinger:configure -- --print   # redacted preview
```

It merges the four secrets from `~/zamzam-private/secrets.env` **on the
server**, so they never enter a local process or a shell history, and refuses
to run if any is missing rather than inventing one.

It also writes `.htaccess.bak` and creates `tmp/`. Both are expected; the
deploy guard allows them by name. See
[environment-reference.md](environment-reference.md).

---

## Things that will catch you out

|                                                       |                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The docroot guard**                                 | It refuses to deploy into a `public_html` containing files it did not place, so a release cannot trample the merchant's other site. Its allow-list once omitted `.htaccess.bak` and `tmp/` — files this system creates — so every deploy after the first refused to run. Fixed 2026-09-14. If it fires, **read the names before relaxing it**: a real second site must still be refused. |
| **`node` is not on the PATH**                         | Deploys export it explicitly and pass `--ignore-scripts`.                                                                                                                                                                                                                                                                                                                                |
| **Passenger runs Node 24**                            | `/opt/alt/alt-nodejs24/…`, satisfying `engines: >=22.22.0`. The deploy script's `--node-bin` default still names the Node 20 path; pass `--node-bin` if that ever matters for the install step.                                                                                                                                                                                          |
| **`wait_timeout` is 20 seconds**                      | The pool's `idleTimeout` is 10s to stay under it.                                                                                                                                                                                                                                                                                                                                        |
| **Uploads and secrets live outside the release tree** | `~/zamzam-storage/public` and `~/zamzam-private`. Never move them under a directory a deploy replaces.                                                                                                                                                                                                                                                                                   |
| **A missing variable now fails at startup by name**   | `DB_PASSWORD is not set`, rather than a MySQL access-denied error for an empty user.                                                                                                                                                                                                                                                                                                     |

---

## Release checklist

1. `npm run verify` — 11 checks.
2. `npm run test:e2e`, and `npm run test:e2e:cross` when the change is visual.
3. `npm run build:hostinger`, and start `build/server-node/index.js` against an
   isolated database if the change touches the server.
4. Tag the current production SHA: `pre-release/<name>-<date>`.
5. Merge, push `main`, note the SHA.
6. `npm run hostinger:deploy -- --dry-run`, then deploy.
7. `curl /api/health` — confirm `commit` matches and `dirty` is `false`.
8. Smoke the storefront, `/en`, the admin login surface, favicon and headers.
9. If it is wrong: `--rollback`, then investigate. Do not debug on the live
   symlink.
