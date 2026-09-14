# Environment reference

Every variable the Node server reads, where it comes from, and what happens
when it is missing.

**No value appears in this file.** Names only. The four application secrets
live on the server in `~/zamzam-private/secrets.env` at mode `0600` and are
merged into `.htaccess` by `npm run hostinger:configure`, which runs there —
they have never been in this repository, a local process or a shell history.

Observed against the live deployment on 2026-09-14.

---

## How configuration reaches the application

```
~/zamzam-private/secrets.env        4 secrets, generated on the server, 0600
          │
          │  merged by `npm run hostinger:configure`
          ▼
public_html/.htaccess               SetEnv … ×22, plus Passenger directives
          │
          ▼
Passenger → build/server-node/index.js → server/config.ts (loadConfig)
```

`loadConfig` collects every missing required name and throws a single
`ConfigError` listing all of them **before** returning. It refuses to start
rather than run half-configured. That was not true until 2026-09-14: the four
`DB_*` reads happened after the check, so a missing one produced an empty
credential and a confusing runtime failure instead of a named startup error.
See `tests/unit/server-config.test.ts`.

---

## Required — the server will not start without these

| Variable                  | Phase   | Present | Validation                                                      | Source              |
| ------------------------- | ------- | ------- | --------------------------------------------------------------- | ------------------- |
| `APP_BASE_URL`            | runtime | yes     | must be `scheme://host`, no path; warns if `http` in production | `.htaccess`         |
| `PUBLIC_MEDIA_ROOT`       | runtime | yes     | must exist and be writable                                      | `.htaccess`         |
| `PRIVATE_MEDIA_ROOT`      | runtime | yes     | must exist and be writable                                      | `.htaccess`         |
| `BETTER_AUTH_SECRET`      | runtime | yes     | length floor                                                    | server secrets file |
| `SETTINGS_ENCRYPTION_KEY` | runtime | yes     | 32 bytes, base64                                                | server secrets file |
| `DB_HOST`                 | runtime | yes     | non-empty                                                       | `.htaccess`         |
| `DB_USER`                 | runtime | yes     | non-empty                                                       | `.htaccess`         |
| `DB_PASSWORD`             | runtime | yes     | non-empty                                                       | `.htaccess`         |
| `DB_NAME`                 | runtime | yes     | non-empty                                                       | `.htaccess`         |

A blank string counts as missing. hPanel writes one when a variable is created
and left empty, which is a more common state than genuinely absent.

## Set, with defaults if absent

| Variable                    | Phase   | Present | Notes                                                                                  |
| --------------------------- | ------- | ------- | -------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | both    | yes     | defaults to `production`                                                               |
| `APP_ENV`                   | runtime | yes     | defaults to `NODE_ENV`; gates the cache-reveal header, which is never on in production |
| `DB_PORT`                   | runtime | yes     | 3306                                                                                   |
| `DB_CONNECTION_LIMIT`       | runtime | yes     | 8, against the host's `MAX_USER_CONNECTIONS 75`                                        |
| `DB_SSL`                    | runtime | yes     | —                                                                                      |
| `DEFAULT_LOCALE`            | both    | yes     | `it`                                                                                   |
| `SUPPORTED_LOCALES`         | both    | yes     | `it,en`                                                                                |
| `DEFAULT_CURRENCY`          | both    | yes     | `EUR`                                                                                  |
| `STORE_TIMEZONE`            | runtime | yes     | `Europe/Rome`                                                                          |
| `TRUSTED_HOSTS`             | runtime | yes     | a request for an unlisted host gets **421 Misdirected Request**                        |
| `TOTP_ISSUER`               | runtime | yes     | the name shown in the authenticator app                                                |
| `JOB_AUTH_SECRET`           | runtime | yes     | header secret for `POST /api/jobs/run`; never a query string                           |
| `INITIAL_ADMIN_SETUP_TOKEN` | runtime | yes     | only meaningful until installation completes                                           |

`HOST` and `PORT` are **not** set, deliberately: Passenger provides the socket.
Setting them would override host-provided behaviour.

## Optional — absent, and correctly so

| Variable                                                             | Effect of absence                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | `emailConfigured: false`. No transactional mail, and **no password reset** — Better Auth registers `sendResetPassword` only when a provider exists, which is better than a reset that silently goes nowhere. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                         | `turnstileConfigured: false`. The widget does not render and no check is claimed.                                                                                                                            |
| `PUBLIC_MEDIA_BASE_URL`                                              | Media is served from the app's own `/media` route.                                                                                                                                                           |
| `DB_SSL_CA_PATH`                                                     | Only needed where the database requires a CA bundle.                                                                                                                                                         |

None of these is populated with a placeholder. A fake value would make a
feature look configured while it silently fails.

---

## Secrets: what must never be regenerated

Two of the four cannot be rotated without destroying data:

- **`BETTER_AUTH_SECRET`** — a new one invalidates every session **and makes
  existing TOTP enrolments unreadable**. Staff would be locked out of their own
  second factor.
- **`SETTINGS_ENCRYPTION_KEY`** — a new one makes saved payment identifiers
  undecryptable. Neither is recoverable from the ciphertext.

Generate one only when it is genuinely absent and nothing is encrypted with it.
If a required existing key is inaccessible, that is a blocker to report, not
something to work around by resetting it.

`hostinger:configure` refuses to run when any of the four is missing rather
than inventing one, and its `--print` output redacts them.

---

## Storage

| Path                               | Holds                                        | Survives a deploy              |
| ---------------------------------- | -------------------------------------------- | ------------------------------ |
| `~/zamzam-storage/public`          | merchant media (73 files as of this release) | yes — outside the release tree |
| `~/zamzam-private`                 | payment proofs, `secrets.env`                | yes — outside the release tree |
| `…/domains/<domain>/releases/<ts>` | one release                                  | replaced; 3 kept               |
| `…/domains/<domain>/current`       | symlink to the live release                  | moved atomically               |

Uploads are deliberately **not** under any directory a deployment replaces.
Private files are never under the public root.
