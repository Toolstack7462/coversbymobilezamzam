# Security threat model

## What an attacker wants here

1. **Redirect payments.** Change the IBAN or Satispay identifier and every future
   transfer goes to them. Highest value, lowest effort, easiest to miss.
2. **Get goods without paying.** Mark an order paid, or tamper a price to zero.
3. **Harvest customer data.** Names, addresses, phone numbers, payment proofs.
4. **Vandalise the catalogue.** Prices, stock, content.

Everything below is ordered by that, not by CVE taxonomy.

---

## Trust boundaries

    Public internet
        │
        ├─► Storefront (anonymous)         ── untrusted input
        ├─► Customer account (authenticated)── untrusted input
        ├─► Admin (staff, RBAC)            ── semi-trusted, still validated
        └─► Cron (internal)                ── trusted trigger, untrusted data
                │
            Worker  ──►  D1 · R2 public · R2 private · Resend

**Staff input is validated too.** A compromised staff session is exactly the
scenario where validation matters most.

---

## Controls by threat

### Payment redirection — the crown jewels

| Control | Where |
|---|---|
| IBAN encrypted at rest (AES-GCM, key in Cloudflare secret) | `infrastructure/encryption` |
| Step-up auth to change IBAN, beneficiary or merchant identifiers | `payment.settings` use case |
| Every change audited with before/after | `audit_logs` |
| Full IBAN never logged, never in an error, never in an export | Logger redaction list |
| Masked form stored separately so ordinary screens never decrypt | `payment_methods` |
| Separate permission from ordinary admin | RBAC |

### Payment status manipulation

Only `payment.verify` holders, with step-up, through the verification use case.
No automatic transition from proof upload, amount match or WhatsApp click
(invariant 6). `tests/security/payment-verification.test.ts`.

### Price and total tampering

Prices are re-read server-side inside the order transaction. Client price,
discount, shipping and total fields are **ignored, not validated** — accepting a
field and checking it is one refactor away from trusting it.
`tests/security/tampered-price.test.ts`.

### Stock manipulation

Quantities are validated against `available` by conditional write. Negative and
non-integer quantities rejected by Zod. Reservation release only through the
ledger.

### IDOR

Every order, proof, address and customer lookup is scoped by ownership or staff
permission **in the query**, not after fetching. Public order tracking uses a
32-character random token, never a sequential id or order number.
`tests/security/idor.test.ts`.

### Order enumeration

`ITA-20260830-AB12CD` is partly guessable — the date is right there. So the
order number alone never authorises access; tracking requires the random token,
and the tracking endpoint is rate-limited.

### Privilege escalation

Permissions are checked server-side per endpoint. Hiding a menu item is not
authorisation. Role assignment requires `staff.roles` plus step-up. A user
cannot grant themselves a permission they lack.
`tests/security/rbac.test.ts`.

### Injection

Drizzle parameterised queries throughout. No string-concatenated SQL. FTS5
queries are escaped — user input reaching an FTS `MATCH` unescaped is a real
injection surface, not a theoretical one.

### XSS

React escapes by default. `dangerouslySetInnerHTML` is used nowhere.
Merchant rich text is sanitised on write with an allowlist, and a strict CSP
without `unsafe-inline` is served. `tests/security/xss.test.ts` stores a payload
in a product name and asserts it renders inert.

### CSRF

`SameSite=Lax` cookies, `__Host-` prefix, origin checking on every mutating
request, and Better Auth's own protections. Mutations are never `GET`.

### Mass assignment

Zod schemas are explicit allowlists per endpoint. No object is spread into an
update.

### File upload abuse

Private bucket · presigned short-lived upload · order-scoped authorisation ·
MIME, extension **and magic-byte** validation · size cap · random key · server
finalisation · no public URL · access logged.

Extension and Content-Type are attacker-controlled; the magic-byte check is the
one that is not.

### Malicious CSV and formula injection

Imports are parsed with an explicit column allowlist, row limits and per-row
validation, and always produce a dry-run report before anything is written.

Exports neutralise any cell beginning `=` `+` `-` `@` by prefixing an apostrophe.
Without it, a product name a supplier chose becomes a formula that runs when the
merchant opens the export in Excel. `tests/security/csv-injection.test.ts`.

### Brute force and credential stuffing

Rate limiting on login, password reset and tracking lookup. Turnstile on
registration, reset, contact and proof submission when configured. Generic
password-reset responses — the site never reveals whether an email exists.

### Session security

Better Auth: HttpOnly, Secure, SameSite, rotation on privilege change, server-side
revocation, listed devices, explicit logout.

### Unsafe redirects

Post-login and post-action redirects are validated against an internal allowlist.
No open redirect from a query parameter.

### Sensitive data in logs

Redaction list: passwords, tokens, session ids, full IBAN, proof contents, email
bodies, `SETTINGS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`. Logs carry a request id
for correlation without carrying content.

### Idempotency abuse

Keys are scoped to the customer or session and expire. A replayed key returns the
original result and never performs the action twice.

---

## Turnstile

Applied to registration, login after repeated failures, password reset, contact
and proof submission — **when configured**. Verified server-side against
siteverify; a token that only passes client-side proves nothing.

Cloudflare's documented always-pass test keys are used in automated tests.

If Turnstile is unconfigured or fails, the form still works and rate limiting
still applies. A bot defence that locks out real customers with no recovery path
has made things worse.

---

## Headers

Strict CSP without `unsafe-inline` · `X-Content-Type-Options: nosniff` ·
`Referrer-Policy: strict-origin-when-cross-origin` · `X-Frame-Options: DENY` ·
HSTS in production · restrictive `Permissions-Policy`.

---

## Two-factor authentication

TOTP is supported. It is a **launch blocker**, not a suggestion, for super
administrators, payment verifiers, and anyone who can change payment identifiers.

A single stolen password on one of those accounts is the payment-redirection
scenario at the top of this document.

---

## Accepted risks in Phase 1

| Risk | Why accepted |
|---|---|
| No automated payment reconciliation | No gateway. Human verification is the control, and it is enforced. |
| WhatsApp content is outside the system | Click-to-Chat by design. Nothing sensitive is put in the message. |
| Customer email is unverified at guest checkout | Guest checkout is required. Orders are identified by number plus token, not email. |
| Rate limiting is per-Worker-instance | Adequate at this traffic. Revisit with a durable counter if abuse appears. |
