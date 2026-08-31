# Deploying the preview

    npm run deploy:preview

That is the whole command. The rest of this page explains why it is not
`wrangler deploy --env preview`, because that is the command everyone reaches
for and it does something quietly wrong.

---

## The trap

**`wrangler deploy --env preview` deploys the BASE configuration and reports
success.**

This project builds through `@cloudflare/vite-plugin`. The plugin resolves the
Wrangler environment at **build** time and writes a flattened
`build/server/wrangler.json` that has no `env` key at all — the chosen
environment's values are merged into the top level. `wrangler deploy` then reads
_that generated file_, not `wrangler.jsonc`. So `--env preview` looks for an
environment in a file that has none, finds nothing, and proceeds with whatever
the build produced.

If the last build was a plain `npm run build`, that is the base configuration:
the base Worker name, the base D1 binding, and `APP_ENV: "development"`. The
deploy succeeds. Nothing warns you.

This was hit twice while setting the environment up. The second time, a bare
`wrangler deploy` after `npm run verify` (which runs a plain build) targeted the
base Worker `ita-commerce` — and failed only because the base configuration
still carries a placeholder database ID. **That placeholder is load-bearing.**
Do not replace it with a real production database ID until production is
genuinely being deployed, because right now it is the thing standing between a
mistyped command and a deploy against the wrong data.

## How the environment is actually chosen

    CLOUDFLARE_ENV=preview   ← before the build, not after

`scripts/deploy/preview.mjs` sets it, runs the build, and then **re-reads the
generated config and refuses to deploy** unless:

- the Worker name is `italian-tech-atelier-commerce-preview`;
- `APP_ENV` is `preview`;
- the D1 binding is `ita-commerce-preview-db`;
- both preview R2 buckets are bound;
- the plugin's own `targetEnvironment` says `preview`;
- no resource name contains `prod` or `live`.

That check is the one that would have caught the silent base deploy, and it runs
on every deploy rather than on the days somebody remembers to look.

A plain `CLOUDFLARE_ENV=preview npm run build` does not work on Windows, where
npm runs scripts through cmd and `VAR=value command` is not understood. A short
Node script beats adding a dependency to set one environment variable.

---

## Which commands take `--env`, and which do not

This is the confusing part, and the rule is not arbitrary:

| Command                    | Reads                        | `--env` |
| -------------------------- | ---------------------------- | ------- |
| `wrangler d1 migrations …` | `wrangler.jsonc` (source)    | **yes** |
| `wrangler d1 execute …`    | `wrangler.jsonc` (source)    | **yes** |
| `wrangler secret put …`    | `wrangler.jsonc` (source)    | **yes** |
| `wrangler deploy`          | `build/server/wrangler.json` | **no**  |

Anything that reads the source config understands environments. Deploy reads the
build output, which has already had the environment baked in.

So a preview D1 command needs `--env preview` — without it Wrangler reports
`Couldn't find a D1 DB with the name or binding`, which is technically accurate
and gives no hint that a missing environment is the reason.

---

## Order of operations

1. `npm run verify` — never deploy something unverified.
2. `npm run backup:preview` — before any migration, without exception.
3. `npx wrangler d1 migrations apply DB --env preview --remote`
4. `npm run deploy:preview`
5. `npm run smoke:preview` — 60 checks against the deployed site.

**On a first deploy to a new hostname**, insert between 4 and 5: read the
workers.dev URL from the output, set `APP_BASE_URL` to that exact origin in the
preview `vars`, and deploy again.

That second deploy is not optional. Better Auth validates every request's origin
against `APP_BASE_URL` and the origin is not knowable until the Worker has a
hostname — so the first deploy necessarily runs without it, and until the second
one happens `trustedOrigins` is `[undefined]` and **nobody can sign in**. It
fails looking like a wrong password, and nothing local reproduces it.

`createAuth` now throws if the variable is missing, so the failure at least
names itself.

---

## Verifying a deploy

`npm run smoke:preview` runs 60 checks against the live site: that D1 and both
buckets answer, that every admin route redirects an anonymous visitor to the
login page, that a forged `Origin` is refused with 403 while the real one
reaches the credential check, that no page sets a cookie, and that the whole
site is `noindex`.

The admin gate list is parsed out of `app/routes.ts`, so a new admin page is
checked automatically. It is worth knowing why: hand-listing the routes would
mean a new page is unprotected AND untested on the same day somebody forgets,
which are exactly the two failures that have to coincide for a leak.

The suite also refuses a deploy made from a dirty working tree, by comparing the
commit reported by `/api/health` against the repository.

---

## Prerequisite: a workers.dev subdomain

An account has **one** `*.workers.dev` subdomain, chosen once, shared by every
Worker on it. Until it is registered, a deploy with `workers_dev: true` uploads
the Worker and then fails with:

    You need to register a workers.dev subdomain before publishing to workers.dev

Register it at `dash.cloudflare.com/<account id>/workers/onboarding`. It cannot
be done from the CLI non-interactively, and the name is account-wide and
effectively permanent — so it is the account owner's decision, not a deployment
detail.

**This account's subdomain is `genzdigitaltools7462`**, so the preview is at:

    https://italian-tech-atelier-commerce-preview.genzdigitaltools7462.workers.dev

Per-version preview URLs are turned off (`"preview_urls": false`). Wrangler
otherwise publishes an extra hostname for every deploy, and `APP_BASE_URL` can
only name one of them — so auth would work on the canonical URL and fail on
every other, and anyone handed the wrong link would report the shop as broken.
