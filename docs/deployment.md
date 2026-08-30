# Deployment

**Nothing here has been run against a real Cloudflare account.** No resources
were created, no secret was set, and no deployment was performed. These are the
exact commands, in order, for whoever does it.

`git push` and a Cloudflare deploy are **separate actions**. Neither implies the
other, and production deployment requires explicit authorisation every time
(ADR 0010).

---

## 1. GitHub — current status

**`gh` is installed (2.95.0) but NOT authenticated.** `gh auth status` reports no
logged-in host, so no remote is configured and nothing has been pushed.

Under the brief's rules no remote may be invented and no credentials requested.
All work is committed locally.

### To push, once authenticated

    gh auth login
    cd C:\Users\User\italian-tech-atelier-commerce
    npm run verify                    # must pass
    npm run secret-scan               # must be clean
    git status --porcelain            # must be empty

    gh repo create italian-tech-atelier-commerce \
      --private --source . --remote origin --push

Then confirm it actually happened, rather than assuming:

    git remote -v
    git ls-remote --heads origin main

**This is a NEW repository, deliberately.** It is not pushed into
`Toolstack7462/coversbymobiile`, which holds the Shopify theme: a theme only
works with `layout/`, `sections/` and `templates/` at the repository root, and
the two projects have unrelated deployment paths. Confirmed with the merchant.

---

## 2. Cloudflare resources

Create these once, per environment. **Do not create production resources
without authorisation.**

    # D1
    npx wrangler d1 create ita-commerce
    # → paste the returned database_id into wrangler.jsonc

    # R2: two buckets, deliberately separate (ADR 0004)
    npx wrangler r2 bucket create ita-commerce-media
    npx wrangler r2 bucket create ita-commerce-private

**The private bucket must never be given a public URL or an `r2.dev` domain.**
Payment proofs live there. Every read goes through an authenticated route that
checks staff permission and logs the access.

Optional, when bot protection is wanted: create a Turnstile widget in the
dashboard and take both keys.

---

## 3. Secrets

Never in a file, never in `wrangler.jsonc`, never in git.

    npx wrangler secret put BETTER_AUTH_SECRET        # openssl rand -base64 32
    npx wrangler secret put SETTINGS_ENCRYPTION_KEY   # openssl rand -base64 32
    npx wrangler secret put APP_BASE_URL

    # Optional. Each gates a feature; absent means the feature stays off.
    npx wrangler secret put TURNSTILE_SITE_KEY
    npx wrangler secret put TURNSTILE_SECRET_KEY
    npx wrangler secret put RESEND_API_KEY
    npx wrangler secret put EMAIL_FROM
    npx wrangler secret put PUBLIC_MEDIA_BASE_URL

**`SETTINGS_ENCRYPTION_KEY` cannot be rotated casually.** Rotating it without
re-encrypting makes every stored IBAN unreadable. See
`docs/operations-runbook.md`.

---

## 4. Migrations

Forward-only, reviewed files (ADR 0008). **Back up before every remote apply.**

    npm run db:migrate:local          # local development
    npm run backup                    # BEFORE the remote apply
    npm run db:migrate:remote

`npx wrangler d1 migrations list ita-commerce --remote` shows what is applied.

---

## 5. Local development

    cp .dev.vars.example .dev.vars    # fill in the three required values
    npm install
    npm run db:migrate:local
    npm run db:seed
    npm run dev

**There is no administrator to create yet.** Authentication and the admin panel
are not implemented in this pass, so there is no default account, no public
admin registration, and deliberately no bootstrap script - one that appeared to
work would be misleading. See `docs/known-limitations.md`.

---

## 6. Staging

Requires authorisation. Staging is safe to deploy to; production is not.

    npx wrangler d1 create ita-commerce-staging
    npx wrangler r2 bucket create ita-commerce-media-staging
    npx wrangler r2 bucket create ita-commerce-private-staging
    # paste the database_id into the staging env in wrangler.jsonc

    npx wrangler secret put BETTER_AUTH_SECRET --env staging
    npx wrangler secret put SETTINGS_ENCRYPTION_KEY --env staging
    npx wrangler secret put APP_BASE_URL --env staging

    npm run verify
    npm run build
    npx wrangler deploy --env staging
    npx wrangler d1 migrations apply ita-commerce-staging --remote --env staging

**Core Web Vitals are measured here**, against the deployed preview. A localhost
Lighthouse run is not evidence.

---

## 7. Production

**Requires separate explicit authorisation, every time.**

Before deploying, every gate in `docs/launch-checklist.md` must have evidence —
including merchant data, legal review, fiscal review, a _tested_ backup restore
and measured performance.

    npm run verify
    npm run backup
    npx wrangler deploy --env production
    npx wrangler d1 migrations apply ita-commerce-production --remote --env production

Then smoke test: homepage renders, a product page renders, an order can be
created, the reservation appears, the cron sweeper runs.

### Rollback

    npx wrangler deployments list
    npx wrangler rollback [deployment-id]

**A code rollback does not undo a migration.** If the release included a schema
change, follow `docs/backup-and-restore.md` instead.

---

## 8. Cron

Configured in `wrangler.jsonc`: `*/5 * * * *`, **UTC**, running the reservation
sweeper.

Verify after deploying:

    npx wrangler tail --env production

Or query the database, which is the more reliable check:

    SELECT job_name, status, started_at, items_processed
      FROM scheduled_job_runs ORDER BY started_at DESC LIMIT 10;

A sweeper that silently stopped leaves stock reserved forever, so this is worth
an alert rather than an occasional glance.

---

## 9. What CI does and does not do

`.github/workflows/ci.yml` runs the full verification suite on every push and
pull request. **It does not deploy**, deliberately: a push that reaches a live
store means a mistake reaches customers at commit speed.
