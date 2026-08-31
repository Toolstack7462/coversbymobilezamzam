# Attaching a custom domain — later, not now

**Nothing here has been done.** No domain is attached, no DNS record exists, no
route is configured. This is written down so that when it happens it is a
sequence somebody follows rather than a sequence somebody invents, and because
two of the steps are easy to get wrong in ways that take the shop offline.

The preview deliberately lives on `workers.dev`. A custom domain would make it
indistinguishable from a real shop, and the whole point of a preview is that
anyone who lands on it can tell.

---

## What has to be true first

Attaching a domain is the smallest part of going live. Ahead of it:

- the legal pages contain real text, reviewed (currently empty placeholders);
- a _commercialista_ has ruled on invoicing;
- a real payment method is configured and tested;
- two-factor is enforced for super admins and payment verifiers;
- the backup restore has been rehearsed at production size;
- the CPU headroom question is settled — see
  [free-plan-cpu-results.md](./free-plan-cpu-results.md).

A domain pointed at an unfinished shop is worse than no domain, because it is
the version customers and search engines will remember.

---

## The order

### 1. Create production resources first

Production has never been created. `wrangler.jsonc` carries a **placeholder
database id** for it, and that placeholder is load-bearing: it is what makes a
mistyped deploy fail instead of succeeding against the wrong data. Replace it
only when production genuinely exists.

    npx wrangler d1 create ita-commerce-production --jurisdiction eu
    npx wrangler r2 bucket create ita-commerce-production-media --jurisdiction eu
    npx wrangler r2 bucket create ita-commerce-production-proofs --jurisdiction eu

**Jurisdiction is set at creation and cannot be changed.** Getting it wrong
means recreating the resource and moving the data. The merchant and their
customers are in Italy; it is `eu`.

### 2. Set every secret for the new environment

Secrets are per-environment. They do not carry over, and a missing one is not a
warning — see [preview-secrets.md](./preview-secrets.md) for the list.

`SETTINGS_ENCRYPTION_KEY` deserves separate attention: if it is lost, every
stored IBAN becomes unreadable. Put it in a password manager before it is used,
not after.

### 3. Attach the domain

In the dashboard: **Workers & Pages → the Worker → Settings → Domains &
Routes → Add → Custom Domain**. Cloudflare creates the DNS record and issues the
certificate.

Use a **Custom Domain**, not a Route. A Custom Domain creates the DNS record and
manages the certificate; a Route matches a pattern on a zone you have already
pointed somewhere, and choosing it by mistake gives a domain that resolves to
nothing.

### 4. Set APP_BASE_URL — before announcing the domain

    "APP_BASE_URL": "https://www.example.it"

Exact origin, scheme included, no trailing slash. Better Auth validates every
request's origin against it and signs cookies against it.

This is the step that has already bitten this project once. On the preview's
first deploy `APP_BASE_URL` was unset, so `trustedOrigins` was `[undefined]` and
every sign-in was refused — presenting as a wrong password, with nothing local
reproducing it. `createAuth` now throws when it is missing, but it cannot tell
that a value is _stale_: a domain change with the old origin still configured
locks out every member of staff, and the error will say the password is wrong.

Deploy again after changing it. Then sign in, from a fresh browser profile,
before telling anyone the address.

### 5. Turn the preview's protections OFF for production, deliberately

The preview is `noindex` everywhere, and that is not a setting to leave on by
habit:

- `app/routes/api/robots.tsx` generates `robots.txt` from `APP_ENV`; production
  must serve a real one.
- `workers/app.ts` adds `x-robots-tag: noindex` for every non-production
  environment.
- The storefront layout renders the "Ambiente di prova" banner whenever
  `APP_ENV` is not `production`.

All three are driven by `APP_ENV`, so they turn off together when it is
`production` — which is exactly why `APP_ENV` must be right before the domain is
announced, and why nothing here should be removed to "clean up".

### 6. Only then

Submit the sitemap. Enable analytics. Announce the address.

---

## What to keep

Keep the preview. Once production exists, the preview is where a change is tried
before it reaches customers — which is worth more than the few pennies of D1
storage it costs.

Keep `workers_dev: false` on production. The Worker would otherwise also answer
on `italian-tech-atelier-commerce-production.<subdomain>.workers.dev`: a second
public address for the real shop, on a hostname nobody is watching, serving
content that `APP_BASE_URL` does not describe.
