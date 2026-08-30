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
- [ ] First administrator created at `/admin/installazione`
- [ ] Staff accounts created with **least-privilege** roles
- [ ] **Two-factor enabled for every super admin** — blocker
- [ ] **Two-factor enabled for every payment verifier** — blocker
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
- [x] Bundle budgets met (118.9 KB JS / 2.4 KB CSS gzipped)
- [ ] Browser tests written and passing
- [ ] **Backup restore actually performed** against a disposable database — a
      backup nobody has restored is not a backup
- [ ] **Core Web Vitals measured on a deployed preview** — localhost is not
      evidence
- [ ] Independent accessibility audit including screen-reader testing
- [ ] Cron confirmed running in production (`scheduled_job_runs`)
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
