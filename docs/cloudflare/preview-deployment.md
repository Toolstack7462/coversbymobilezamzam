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
2. `npx wrangler d1 migrations apply DB --env preview --remote`
3. `npm run deploy:preview`
4. Read the workers.dev URL from the output.
5. Set `APP_BASE_URL` to that exact origin in the preview `vars`.
6. `npm run deploy:preview` again.

Steps 4–6 exist because Better Auth needs to know its own origin, and the origin
is not knowable until the Worker has a hostname. The second deploy is not
optional: until it happens, `APP_BASE_URL` is missing and every absolute URL and
origin check is working from nothing.

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

The resulting URL is:

    https://italian-tech-atelier-commerce-preview.<subdomain>.workers.dev
