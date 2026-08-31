# Launch checklist

**Current status: DO NOT LAUNCH.**

Not because anything is broken, but because launching requires evidence that
does not exist yet. Most of what remains is the merchant's to supply or a
professional's to sign off, and none of it can be produced by writing more code.

A gate is met when there is **evidence**, not when someone believes it is fine.

---

## Merchant information

- [ ] Public brand name configured
- [ ] Physical shop name configured
- [ ] **Ragione sociale** (legal name) configured
- [ ] **P.IVA** configured
- [ ] **REA / Chamber of Commerce** number configured
- [ ] Telephone configured
- [ ] WhatsApp Business number configured
- [ ] Support email configured
- [ ] Opening hours configured (displayed text)
- [ ] Opening hours configured (schema.org format) _or deliberately left blank_
- [ ] Return address configured

Until the first five are set, the footer legal block does not render. That is
correct behaviour, and it is also **not compliant** with D.Lgs. 70/2003 — blank
is safer than wrong, but blank is not lawful for a live shop.

**Open question:** is _ZAM ZAM_ the ragione sociale, or a second brand? It
appears on the merchant's card beneath "Covers by Mobile". This must be resolved
before the legal block can be filled in.

---

## Payment

- [ ] At least one payment method fully configured and active
- [ ] Business IBAN entered (**a business account, never a personal one**)
- [ ] Beneficiary name entered
- [ ] Payment instructions written, in Italian and English
- [ ] Reservation window per method reviewed
- [ ] Satispay Business configured, _or_ deliberately left disabled
- [ ] BANCOMAT Pay left disabled unless **real merchant activation** exists
- [ ] Staff trained: verification means checking the real account, never a
      screenshot
- [ ] Duplicate-reference handling understood (flagged, never auto-rejected)

---

## Store and fulfilment

- [ ] Store address verified on the ground
- [ ] Pickup enabled, with a real preparation time
- [ ] Pickup instructions written
- [ ] Shipping rates configured, _or_ shipping deliberately disabled
- [ ] Free-shipping threshold configured, _or_ deliberately absent
- [ ] Dispatch policy written — a policy, **never an arrival guarantee**

---

## Catalogue

- [ ] Real products imported
- [ ] Prices verified against the shop
- [ ] Inventory counted and reconciled
- [ ] Device brands, families and models entered
- [ ] Compatibility records entered **and verified**
- [ ] Verification source recorded per record (spec sheet vs physical test)
- [ ] Product images uploaded — **the merchant's own, not stock or competitor
      photography**
- [ ] GPSR safety data entered for products in scope
- [ ] EU responsible person stated for every imported product

---

## Security and access

- [x] Authentication and the admin panel implemented
- [x] Initial admin creation is race-safe (atomic singleton claim)
- [x] Mandatory TOTP implemented and enforced for privileged roles
- [x] Invitation-based staff onboarding, no public registration
- [x] Last-super-admin lockout protection
- [ ] First administrator created at `/admin/installazione` (needs INITIAL_ADMIN_SETUP_TOKEN)
- [ ] Staff accounts created with **least-privilege** roles
- [x] Two-factor is **structurally mandatory** for both — an unenrolled
      privileged account can reach only enrolment, recovery, sessions, profile,
      help and sign-out
- [ ] Each real administrator has actually completed enrolment
- [ ] Nobody except a super admin holds both `payment.verify` and
      `payment.settings`
- [ ] `SETTINGS_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` set as Cloudflare
      secrets
- [ ] Turnstile configured, _or_ deliberately disabled
- [ ] `npm run secret-scan` clean on the deployed commit

---

## Legal and fiscal — professional review required

**No legal text ships with this system.** Every page is an empty, clearly
labelled placeholder. Generated legal text that looks finished is more dangerous
than an obviously empty page.

- [ ] Privacy policy — drafted **and reviewed by a lawyer**
- [ ] Cookie policy — matching what the site actually sets
- [ ] Terms and conditions of sale — reviewed
- [ ] Shipping policy — reviewed
- [ ] Returns and 14-day withdrawal — reviewed
- [ ] Standard withdrawal form (Annex I(B)) — provided
- [ ] Legal guarantee of conformity (2 years) explained and distinguished from
      any commercial warranty
- [ ] Product safety page — reviewed
- [ ] Trader identification complete (D.Lgs. 70/2003)
- [ ] **Fiscal workflow reviewed by a commercialista** — invoicing,
      _corrispettivi_, and the _registratore telematico_. This system manages
      inventory and order state; it does **not** replace the fiscal POS.
- [ ] Price-indication compliance confirmed (D.Lgs. 84/2022): every discounted
      product carries a genuine recorded 30-day prior price
- [ ] Accessibility statement published (European Accessibility Act, in force
      for e-commerce since 28 June 2025)

---

## Technical evidence

- [x] `npm run verify` passes — format, lint, types, locales, migrations, unit,
      integration, build, budgets, secret scan
- [x] Concurrency proven: two simultaneous orders for the last unit produce
      exactly one sale
- [x] Expiry race proven: verification and the sweeper cannot both act
- [x] Order snapshots proven immutable under product edits
- [x] Payment verification proven to require permission AND step-up, with the
      step-up consumed so it cannot be replayed
- [x] Proof upload proven not to change payment status
- [x] Bundle budgets met — 121.3 KB storefront JS, 28.6 KB admin JS, 5.3 KB CSS
      (gzipped, `npm run budgets`)
- [x] Browser tests written and passing — 33 passing, 1 skipped by viewport,
      across Desktop Chrome and Pixel 7 (`npm run test:e2e`). They found four
      real WCAG 2.4.2 failures on their first run: the collection, device
      finder, cart and store pages shipped no `<title>`. Fixed in the same
      change.
- [x] Browser coverage extended to signed-in admin screens — a setup project
      installs the shop, logs in and enrols in two-factor through the real
      forms, then every admin screen is opened, scanned with axe, and checked
      for a working sidebar. It found four bugs nothing else could have; see
      `docs/authentication-incidents.md`. Three of them made the application
      unusable: installation could never complete, enrolling in two-factor
      locked the account out permanently, and every correct two-factor code
      was rejected.

- [ ] A staged rehearsal of the first-run flow on a deployed preview. Partly
      done: the preview is deployed, the setup page is open and waiting, and 60
      smoke checks pass against it over real HTTPS — including that a forged
      `Origin` is refused while the real one reaches the credential check. The
      part still outstanding is the merchant creating the first administrator
      and enrolling a factor, which nobody else can do: the setup token is in
      their password manager and the password must be theirs alone. See
      `docs/cloudflare/first-admin-setup.md`.
- [x] **Backup restore actually performed** against a disposable database —
      31 Aug 2026, 207 rows / 20 tables restored exactly, schema rebuilt from
      migrations and the search index rebuilt by its triggers. Preview demo data
      only; not yet repeated at production size. See
      `docs/backup-and-fts-restore.md`.
- [ ] **Core Web Vitals measured on a deployed preview** — localhost is not
      evidence. A preview now exists, so this is unblocked.
- [ ] **Decide on the paid plan.** The storefront renders at 4–7ms of CPU
      against the free plan's 10ms ceiling, with peaks touching it. Nothing is
      failing, but a shop taking real orders has about one page's worth of
      headroom. See `docs/cloudflare/free-plan-cpu-results.md`.
- [ ] Independent accessibility audit including screen-reader testing — axe
      finds roughly a third of WCAG issues, so a clean automated run is a
      floor, not a pass
- [ ] Cron confirmed running in production (`scheduled_job_runs`)
- [ ] **Cron CPU measured with a real backlog.** A Cron Trigger gets the same
      10ms as a page render on the free plan, and the sweeper batches up to 100
      reservations. On an empty preview it finishes in 16ms of wall time, which
      proves only that it is wired up.
- [ ] Alerting configured for a stopped sweeper

---

## Operational readiness

- [ ] Staff know how to verify a payment
- [ ] Staff know how to prepare and record a pickup
- [ ] Staff know what to do about a partial or over payment
- [ ] Someone owns daily payment reconciliation
- [ ] `docs/operations-runbook.md` read by whoever is on call
- [ ] Domain configured and DNS pointed
- [ ] Email sending domain verified, _or_ email deliberately disabled

---

## Sign-off

| Role                                           | Name | Date |
| ---------------------------------------------- | ---- | ---- |
| Avvocato (consumer and e-commerce law)         |      |      |
| Commercialista (VAT, invoicing, corrispettivi) |      |      |
| Accessibility auditor                          |      |      |
| Merchant                                       |      |      |

---

## Status language

Until every box above has evidence, the honest status is one of:

- **DO NOT LAUNCH** — current
- **READY FOR MERCHANT REVIEW** — code complete, merchant data and sign-off
  outstanding

**Never "ready to launch" without the evidence.** A system that builds is not a
system that is ready.
