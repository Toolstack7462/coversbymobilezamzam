# Hostinger capability audit

**Status: BLOCKED on access.** No Hostinger hPanel, SSH or API credential for this
project is configured on the machine this migration is being built on, and none
was supplied. Nothing below claims to have been observed on the merchant's
actual plan. The documented facts come from Hostinger's own support pages and
are cited; the unverified ones are listed as checks for the merchant to run,
with the exact command or screen for each.

This document is the gate. The migration does not deploy to Hostinger until
§3 is filled in with real values.

---

## 1. What access exists, and what does not

| Access             | State         | Evidence                                                                                                                                                                               |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare account | **Available** | `wrangler whoami` — OAuth token, `genzdigitaltools7462@gmail.com`, account `1f6bb660…f864d1`, d1/workers/pages write                                                                   |
| GitHub remote      | **Available** | `github.com/Toolstack7462/coversbymobilezamzam.git`, pushes succeed                                                                                                                    |
| Hostinger hPanel   | **Absent**    | No Hostinger MCP connector is configured (`claude mcp` lists only an unrelated server); no API token in the environment                                                                |
| Hostinger SSH      | **Absent**    | `~/.ssh/known_hosts` holds one host on Hostinger's SSH port (`147.79.103.253:65002`), but no username is known and key-only auth is refused (`Permission denied (publickey,password)`) |

### The host in known_hosts is not assumed to be the target

That entry almost certainly belongs to a **different, unrelated project** on the
same person's hosting. The master prompt is explicit that another website with
its own database, admin and client panel already exists on Hostinger and must
not be touched. Guessing that its account is also the target for Covers by
Mobile Zam Zam — and deploying into it — would be exactly the invention the
prompt forbids, so nothing was attempted against it beyond a read-only
reachability probe that failed on authentication.

**Question for the merchant:** is the Covers by Mobile Zam Zam application to be
deployed into the _same_ Hostinger account as the existing website, or a
separate one? The answer changes the isolation plan in
[hpanel-deployment.md](hpanel-deployment.md), not the code.

---

## 2. What Hostinger's own documentation states

Cited, current as of 2026-09-13. These are **platform** facts, not **plan**
facts — which plan the merchant holds is unknown, and every number below is per
plan.

### Node.js support

From [How to deploy a Node.js website in Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/):

- Supported on **Business Web Hosting** and **Cloud Startup / Professional /
  Enterprise / Enterprise Plus**. Not on Premium or Single.
- Node versions offered: **18.x, 20.x, 22.x, 24.x**.
- GitHub deployment is supported, with automatic builds on every push.
- **One hosting plan connects to only one GitHub account at a time.** This is
  the single most important line in that page for this migration: the existing
  website already has a GitHub connection, and reconnecting the plan to a
  different account would break it.
- Back-end framework builds land in `/home/{username}/domains/{domain}/nodejs`;
  static output in `.../public_html`.
- **"Manual file edits in the File Manager won't persist; source files must be
  updated and redeployed."**

That last point is the whole reason [media-persistence.md](media-persistence.md)
exists. The deployment directory is _replaced_, so anything the application
writes into it — a product photo, a payment proof — is destroyed by the next
push. Persistent storage must live outside it, and **which path is writable and
survives a redeploy is check C-3 below.**

### Database engine

From [Which database management system is used at Hostinger](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/):

> "At Hostinger, our Web and Cloud hosting plans use **MariaDB**, an open-source
> relational database management system, across all our Web and Cloud hosting
> plans."

The page gives **no version number**. Hostinger labels the service "MySQL"
throughout hPanel; the documentation says MariaDB. The port targets MariaDB and
does not assume Oracle MySQL 8 — see [ADR 0002](../adr/0002-mariadb-dialect.md).
The exact version is check **C-2**.

### Plan resource limits

From [Parameters and limits of hosting plans](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/):

| Plan               | CPU | RAM   | Disk   | Inodes    | MySQL connections / user |
| ------------------ | --- | ----- | ------ | --------- | ------------------------ |
| Web Premium        | 1   | 2 GB  | 20 GB  | 400,000   | 50                       |
| Web Unlimited      | 2   | 3 GB  | 50 GB  | 600,000   | 75                       |
| Cloud Startup      | 4   | 4 GB  | 100 GB | 2,000,000 | 100                      |
| Cloud Professional | 5   | 6 GB  | 200 GB | 3,000,000 | 125                      |
| Cloud Enterprise   | 6   | 12 GB | 300 GB | 4,000,000 | 150                      |

The page does not state entry-process or max-process limits, nor a Node.js app
count. Those are checks **C-1** and **C-7**.

**The connection cap is the binding constraint on this application, not CPU.**
The MariaDB pool is therefore configured small (8 connections) and closed on
shutdown — see the header of `app/infrastructure/db/mariadb.ts`. A pool sized
for a machine we own would exhaust a 50-connection cap across a couple of
redeploys.

### Cron

From [How to set up a cron job at Hostinger](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/):

- **"Cron jobs tasks schedule is based on Coordinated Universal Time (UTC+0)."**
  This matches Cloudflare exactly, so the reservation sweeper's schedule
  semantics do not change.
- The page documents PHP files and "custom commands" but does not state whether
  `node` is on the cron PATH, the minimum interval, or the maximum job count.
  Those are checks **C-4**, **C-5** and **C-6**.

The scheduler design does **not** depend on `node` being available to cron. See
[jobs-and-email.md](jobs-and-email.md): the launcher is a transport bridge that
authenticates to a job endpoint, and the business rules stay in the Node
application either way.

---

## 3. Checks the merchant needs to run

Each is a single command or a single hPanel screen. Paste the output back and
the corresponding row in this document gets filled in with a real value.

### C-1 — Plan and Node.js entitlement

hPanel → **Hosting** → the domain → **Advanced** → **Node.js**.

Record: the plan name shown in the hosting sidebar; whether the Node.js entry
exists at all; how many applications the page allows; the Node versions in the
dropdown; and whether "Framework" offers **Express / Other** (server-side) as
well as static React/Vite.

> Why it matters: static-only hosting cannot run this application. It is
> server-rendered, and its loaders, actions, uploads and authentication are all
> server code. A Vite build uploaded to `public_html` would be a shop that
> renders and cannot take an order.

### C-2 — Database engine and version

hPanel → **Databases** → **phpMyAdmin** → **SQL** tab, then:

```sql
SELECT VERSION(), @@version_comment, @@sql_mode,
       @@default_storage_engine, @@character_set_server, @@collation_server,
       @@innodb_ft_min_token_size, @@max_allowed_packet, @@wait_timeout;
```

> Why each column matters:
>
> - `VERSION()` / `@@version_comment` — MariaDB or Oracle MySQL, and which
>   major. The generated schema uses `STORED` generated columns and named CHECK
>   constraints; both need MariaDB 10.2.1+ or MySQL 8.0.16+. **A CHECK
>   constraint on MySQL 5.7 or MariaDB 10.1 is PARSED AND IGNORED** — the
>   oversell guard would appear to exist and never fire.
> - `@@sql_mode` — the import relies on `STRICT_TRANS_TABLES` to reject an
>   over-long value rather than truncate it. If strictness is off, the mode is
>   set per-connection by the adapter instead.
> - `@@innodb_ft_min_token_size` — the search design assumes it cannot be
>   changed and works around it. Worth recording, not worth changing.

### C-3 — Persistent, writable storage outside the build directory

This is the check that decides whether managed hosting is viable at all.

Over SSH (hPanel → **Advanced** → **SSH Access** for the credentials):

```sh
# 1. Where does the deployment actually live, and is it a replaceable link?
ls -la ~/domains/<domain>/
ls -la ~/domains/<domain>/nodejs 2>/dev/null
readlink -f ~/domains/<domain>/nodejs 2>/dev/null

# 2. Create a candidate persistent root OUTSIDE it, and prove it is writable.
mkdir -p ~/zamzam-storage/public ~/zamzam-storage/private
echo "persistence probe $(date -u +%FT%TZ)" > ~/zamzam-storage/private/probe.txt
sha256sum ~/zamzam-storage/private/probe.txt

# 3. Confirm it is NOT reachable from the web.
#    Must return 404, and must NOT return the file's contents.
curl -si https://<domain>/../zamzam-storage/private/probe.txt | head -1
curl -si https://<domain>/zamzam-storage/private/probe.txt | head -1

# 4. Disk and inode headroom, including the other website.
df -h ~ ; df -i ~ ; du -sh ~/domains/*
```

Then **redeploy the application from GitHub**, and run step 2's `sha256sum`
again. The hash must be identical.

> Why the readlink: on Hostinger's Node setup the served directory is commonly a
> symlink into a versioned build tree, and writing to the path the deploy
> replaces is a silent no-op — the file is written, the next deploy discards it,
> and nothing reports an error. The probe has to survive an actual redeployment,
> not just a restart.

**If no writable path outside the replaceable build directory can be
established, the managed-hosting path stops here** and the alternative is a
Hostinger VPS. That decision goes to the merchant with the evidence, not around
them; see [ADR 0003](../adr/0003-persistent-storage.md).

### C-4 — Can cron run Node?

hPanel → **Advanced** → **Cron Jobs**, one-off command, every 5 minutes:

```sh
/usr/bin/env node -v >> ~/cron-probe.log 2>&1; date -u >> ~/cron-probe.log
```

Leave it for fifteen minutes, then `cat ~/cron-probe.log`.

Record: whether `node` resolves at all; which version; and the **actual
interval between the timestamps**, which is the real minimum frequency rather
than the one the dropdown offers.

> If `node` is not on the cron PATH, the fallback is a `curl` launcher against
> an authenticated job endpoint. The business logic does not move either way —
> see [jobs-and-email.md](jobs-and-email.md).

### C-5 — Cron limits

Same screen. Record the maximum number of jobs the plan allows and the shortest
interval the dropdown offers.

> The reservation sweeper currently runs every 5 minutes in the base Cloudflare
> config and every 15 in preview. The interval is the worst-case over-hold on
> stock, so a coarser minimum is a business decision, not a technical blocker.

### C-6 — Mailbox and SMTP

hPanel → **Emails**. Record: whether a mailbox is included in the plan, the
SMTP host and port, the daily sending limit, and whether SPF/DKIM/DMARC are
already published for the domain.

> Email is currently **not configured at all** — the deployed health endpoint
> reports `emailConfigured: false` — so nothing regresses if this is not
> available. It stays configuration-gated.

### C-7 — Current resource usage, including the other site

hPanel → **Hosting** → the domain → the resource-usage panel, plus over SSH:

```sh
ps -u $(whoami) -o pid,rss,etime,cmd --sort=-rss | head -20
free -m 2>/dev/null || true
```

Record CPU, RAM, entry processes, disk and inode usage **before** anything is
deployed, so the migration's cost is measurable rather than asserted.

### C-8 — Backup coverage

hPanel → **Files** → **Backups**. Record what is included (files, databases, or
both), the frequency, the retention, and whether a restore can target a
_different_ destination — a restore that can only overwrite production is not a
restore that can be tested.

---

## 4. What has been established locally, without Hostinger

These are real results from this machine, not projections.

| Fact                                                               | Evidence                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| MariaDB 10.11.19 runs the generated schema with no errors          | 101 tables, 106 foreign keys, 191 indexes, 10 CHECK constraints, all InnoDB / utf8mb4 |
| The partial-unique replacement enforces both original rules        | `npm run test:db:mariadb` — 18/18                                                     |
| The oversell CHECK fires, and a failed batch rolls back completely | same suite                                                                            |
| Exactly one of two concurrent buyers takes the last unit           | same suite                                                                            |
| BIGINT timestamps and integer money survive the driver exactly     | same suite                                                                            |
| 450 of the application's 453 SQL statements translate unchanged    | `npm run hostinger:sql-audit`                                                         |
| The remaining 3 are named, with the reason for each                | same                                                                                  |

MariaDB **10.11.19** was chosen as the local target because it is the current
10.11 LTS and the oldest line still under maintenance that Hostinger plausibly
runs. **If C-2 reports a different version the suite must be re-run against
it** — `TEST_DB_HOST`/`TEST_DB_PORT` point it anywhere, and CI runs it against
a service container.

---

## 5. The source, audited

Run read-only against the live Cloudflare preview on 2026-09-13.

### It is preview-only. It has never taken an order.

| Table                                                              | Rows                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| `orders`                                                           | **0**                                                   |
| `order_items`, `order_payments`, `order_addresses`, `order_events` | **0**                                                   |
| `stock_reservations`                                               | **0**                                                   |
| `payment_proofs`, `payment_proof_access_logs`                      | **0**                                                   |
| `fulfilments`, `shipments`, `returns`, `refunds`                   | **0**                                                   |
| `products` / `product_variants`                                    | 26 / 38                                                 |
| `product_images`                                                   | 26 (1.90 MB, all WebP 900×900, each with a stored hash) |
| `device_models` / `device_families` / `device_brands`              | 36 / 22 / 15                                            |
| `store_settings`                                                   | 32                                                      |
| `user` / `staff_profiles` / `two_factor` / `session`               | 1 / 1 / 1 / 2                                           |
| `scheduled_job_runs`                                               | 1,213                                                   |
| `audit_logs`                                                       | 9                                                       |
| **Total across 102 tables**                                        | **1,817 rows, 1.94 MB**                                 |

R2: `ita-commerce-preview-media` holds **70 objects / 5.87 MB**;
`ita-commerce-preview-proofs` holds **0 objects**.

This single fact reshapes the migration:

- **There is no order, payment or customer history to reconcile**, and no
  private proof to move. The riskiest part of §7 and §8 of the brief — moving
  live transactional data consistently while orders are being placed — does not
  apply _yet_.
- The cutover mode is therefore **pre-transactional**: a catalogue-and-content
  migration, not a live-commerce one. That is a much safer operation and it
  should be done _before_ the shop starts taking orders, not after.
- 26 of the 70 media objects are referenced by `product_images`. The other 44
  are unreferenced and are classified during the media migration rather than
  copied blindly — see [media-persistence.md](media-persistence.md).
- `scheduled_job_runs` (1,213 rows) is operational history from the sweeper. It
  is genuine data and is migrated, not discarded, but it is the one table where
  a retention window is worth agreeing with the merchant.

### Deployed versus local

|                                  | Commit                                                   |
| -------------------------------- | -------------------------------------------------------- |
| Deployed preview (`/api/health`) | `4de2c3d`, **`dirty: true`**, built 2026-09-01T20:00:04Z |
| `origin/main`                    | `36d2c79`                                                |
| Branch point for this work       | `5570343`, tagged `baseline/pre-hostinger-migration`     |

The deployed Worker is **one commit behind** the branch point and was built from
a dirty tree, so its exact source is not reproducible from Git. That is recorded
rather than glossed: any "the deployed SHA equals the release SHA" claim after
cutover is about the _new_ deployment, not this one.

### Cloudflare dependencies inventoried

| Dependency                      | Where                                                 | Replacement                              |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| D1 (`env.DB`)                   | 469 references, 68 files                              | `SqlDatabase` port → mysql2              |
| `D1Database.batch`              | 51 call sites                                         | one transaction on one pooled connection |
| FTS5 virtual table + 4 triggers | `0005_product_search.sql`, one query                  | FULLTEXT + token table                   |
| R2 `MEDIA`                      | 4 references                                          | filesystem object store                  |
| R2 `PRIVATE_FILES`              | 1 reference (health probe)                            | filesystem, outside the web root         |
| `scheduled()` cron handler      | `workers/app.ts`                                      | authenticated job endpoint + launcher    |
| Worker response wrapper         | `workers/app.ts`                                      | Express middleware, same policy          |
| `public/_headers`               | static assets                                         | Express static handler                   |
| `ExecutionContext.waitUntil`    | not used in app code                                  | n/a                                      |
| Cache API                       | not used                                              | n/a                                      |
| Turnstile                       | configured but **off** (`turnstileConfigured: false`) | unchanged, still gated                   |

Only the `preview` environment has real Cloudflare resource ids. `staging` and
`production` in `wrangler.jsonc` are `REPLACE_WITH_…` placeholders and have
never been deployed — so there is no Cloudflare production to cut over _from_.

---

## 6. Honest status

**HOSTINGER STAGING BLOCKED.**

The database port is real and proved against a real MariaDB. Nothing about
Hostinger itself has been verified, because no access to it exists. The
migration continues with non-destructive local work — the runtime port, the
media adapters, the job runner, the data-migration tooling and their tests —
and stops at the point where a Hostinger deployment is required.

To unblock: answer the question in §1 and run checks **C-1** through **C-8**.
C-1, C-2 and C-3 are the three that decide whether the managed-hosting path is
viable at all.
