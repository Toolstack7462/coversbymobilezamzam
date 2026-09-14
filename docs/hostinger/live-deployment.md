# The live deployment

What is running on Hostinger, how it got there, and how to do it again.

Written from the deployment itself on 2026-09-14, not from a plan. Everything
in it was observed.

---

## 1. What is live

|            |                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| URL        | **https://coversbymobile.com**                                                                                             |
| Account    | `u995575981` on `fr-int-web1347.main-hosting.eu` — **only this site**, the merchant's other website is a different account |
| Runtime    | Node **v20.19.4** (`/opt/alt/alt-nodejs20`), one persistent process under LiteSpeed                                        |
| Database   | **MariaDB 11.8.9**, `u995575981_Coversbymobile`, 103 InnoDB tables                                                         |
| Storage    | `~/zamzam-storage/public` (media), `~/zamzam-private` (proofs, secrets) — both outside every deployment path               |
| Cloudflare | **Untouched and still serving.** Nothing has been deleted, no DNS moved.                                                   |

Migrated: **1,864 rows across 100 tables**, reconciled against the export
manifest with zero rejections and zero differences, and **36 media objects**,
size-verified per key.

---

## 2. How it is wired

```
coversbymobile.com
  └── public_html/.htaccess          Passenger directives + SetEnv config
        │                            (403 to the web; the app root is 404)
        ▼
      current ─symlink→ releases/<timestamp>/
        ├── build/server-node/index.js   ← PassengerStartupFile
        ├── build/client/                 static assets
        ├── node_modules/                 npm ci --omit=dev --ignore-scripts
        ├── db/mariadb/migrations/        the SQL that matches THIS build
        └── scripts/hostinger/            migrate, import, run-job
```

Three commands, and they are deliberately separate:

```sh
npm run hostinger:deploy      # build, upload, install, check, switch, restart
npm run hostinger:configure   # .htaccess: where the app is, and its settings
npm run hostinger:migrate     # schema, applied on purpose and never by a deploy
```

Rolling back is `npm run hostinger:deploy -- --rollback` — a symlink move, not
a rebuild. Three releases are kept.

### Why not Hostinger's Git deployment

It was already set up, and it had been failing silently. The build log ends:

```
ERROR: No output directory found after build
```

It is a **static-site** flow: it runs `npm run build` and then looks for a
directory of files to publish into `public_html`. `npm run build` is the
_Cloudflare_ build, and an SSR application has no directory to publish — the
thing that serves the site is a process. Hence the parked page, and no
explanation anywhere.

---

## 3. Credentials

**Nothing is in the repository.** The four application secrets were generated
**on the server**, live in `~/zamzam-private/secrets.env` at mode `0600`, and
are merged into `.htaccess` by a command that runs there — they have never been
in a local process, a shell history or an argument list.

`hostinger:configure` refuses to run if any of them is missing rather than
inventing one.

> **Two of them cannot be rotated without cost.** A new `BETTER_AUTH_SECRET`
> invalidates every session **and makes existing TOTP enrolments unreadable**. A
> new `SETTINGS_ENCRYPTION_KEY` makes saved payment identifiers undecryptable.
> Neither is recoverable from the ciphertext.

---

## 4. Things about this plan that had to be discovered

Each one broke something, and none of them is visible from documentation.

|                                                                                |                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`sql_mode` has no `STRICT_TRANS_TABLES`**                                    | MariaDB silently truncates over-long strings and turns bad numbers into 0. The adapter now sets its own mode per connection.                                                                 |
| **A prepared statement's parameter uses a different collation from a literal** | `Illegal mix of collations`. Took every page down while `/api/health` — which compares nothing — reported "ok". The adapter now issues `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`.       |
| **`wait_timeout` is 20 seconds**                                               | An idle pooled connection is closed by the server; the pool finds out by handing a dead one to the first visitor after a quiet spell. `idleTimeout` is now 10s.                              |
| **`MAX_USER_CONNECTIONS 75`, `MAX_STATEMENT_TIME 120`**                        | The connection budget of 8 + 2 is comfortable. The statement cap is far above the slowest migration statement (3.4 s).                                                                       |
| **The database refuses rapid connection churn**                                | A probe opening one connection per query had 551 of 731 attempts fail with `Can't connect to local server through socket`. Anything that loops over queries must reuse a connection.         |
| **No `crontab` in the CageFS jail**                                            | Scheduled jobs are an hPanel screen. Both launchers work — see §6.                                                                                                                           |
| **`node` is not on the default PATH**                                          | Install scripts calling `node` by name fail with `sh: node: command not found`. Deploys export the path explicitly and pass `--ignore-scripts`.                                              |
| **The preview R2 buckets are EU-jurisdiction**                                 | `wrangler r2 bucket list` does not show them and every download fails with "The specified key does not exist" — a message about the key, for a problem with the bucket. `--jurisdiction eu`. |
| **R2 stored a content type; a filesystem does not**                            | Copying only the bytes gave every image a 200 with no `Content-Type`, and `nosniff` meant browsers refused to guess. The migration writes `.meta.json` sidecars.                             |

### The one that is worth remembering

**Hostinger's CDN caches broken responses under whatever `Cache-Control` they
carry.** Media is served `public, max-age=31536000, immutable`, so the six
images fetched during the content-type bug were pinned in the CDN **for a
year** while the origin was already correct.

A deploy that briefly serves the wrong bytes for a hashed URL poisons that URL
until somebody purges. The purge is hPanel → the website → Performance / CDN.

Confirm with `?cb=<anything>`: if the cache-busted URL is right and the plain
one is wrong, it is the CDN and not the application.

---

## 5. What was verified, and how

|                                 |                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Every storefront route          | `/`, `/shop`, `/trova-dispositivo`, `/negozio`, `/carrello`, `/en` → 200; `/admin` → 302                                               |
| The catalogue renders real data | 24 products, Italian names, `29,90` prices                                                                                             |
| Media                           | 36 objects, correct `image/webp`, `public, max-age=31536000, immutable`                                                                |
| Health                          | database, media store and private store all ok                                                                                         |
| **Backup and restore**          | `npm run hostinger:backup` — dumped, downloaded, restored into a throwaway database, **103 tables and 1,868 rows matched row for row** |
| Scheduled work                  | Both launchers run on the server and record to `scheduled_job_runs`; an unauthenticated `POST /api/jobs/run` is **404**                |
| Nothing sensitive is served     | `.htaccess` and `.htaccess.bak` → 403; `/current/package.json`, `/releases/`, `/api/cache-stats` → 404                                 |

**Not proven:** Hostinger's own restore path. The database user has privileges
on one database and cannot create another, so importing a dump there is an
hPanel action a person takes. The dump itself is proven complete and loadable.

> Probing with `../` and `%2e%2e` patterns got this IP briefly blocked by the
> host's WAF — every request failed for about a minute. Worth knowing before
> concluding the site is down.

---

## 6. Still to do

|                             | Needs                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The admin cannot log in** | The migrated account's TOTP secret was encrypted with the Cloudflare signing key, which Cloudflare does not expose. The second factor has to be reset in the database before anyone can get in — see §7.                                                                                                                                           |
| **Cron**                    | hPanel → Advanced → Cron Jobs, every 5 minutes. Either launcher: `/opt/alt/alt-nodejs20/root/usr/bin/node ~/domains/coversbymobile.com/current/scripts/hostinger/run-job.mjs expire-reservations`, or `curl -fsS -X POST -H "x-job-secret: …" https://coversbymobile.com/api/jobs/run`. Without it, stock stays reserved against abandoned orders. |
| **Email**                   | No SMTP configured, so transactional email is off rather than failing. hPanel → Emails.                                                                                                                                                                                                                                                            |
| **Hostinger backups**       | hPanel → Backups. The application-level backup above is proven; the platform's is not configured.                                                                                                                                                                                                                                                  |
| **Cutover**                 | DNS already points here and the domain already serves the shop. Cloudflare is untouched and can be returned to at any time. Deleting anything there needs the merchant's explicit approval and has not been done.                                                                                                                                  |

---

## 7. Resetting the administrator's second factor

Needed once, because the old secret cannot be decrypted. It weakens nothing —
the existing factor is already unusable.

In hPanel → Databases → phpMyAdmin, on `u995575981_Coversbymobile`:

```sql
DELETE FROM two_factor;
UPDATE user SET two_factor_enabled = 0;
DELETE FROM session;
```

Then sign in at `/admin/accedi` with the existing email and password. The shell
will require enrolment before anything operational, so the next screen is a
fresh authenticator — new QR code, new recovery codes.

`DELETE FROM session` is there so any half-open session from the migration is
gone rather than lingering with the old state.
