# Security

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not open a
public issue. Please include reproduction steps and the impact you observed.

## What matters most here

In order of what an attacker actually gains:

1. **Payment redirection.** Changing the business IBAN or a merchant identifier
   redirects every future payment. Protected by encryption at rest, step-up
   authentication, a dedicated permission, and audit logging.
2. **Marking orders paid.** Only an authenticated staff user holding
   `payment.verify`, with step-up authentication, may do this. **No automatic
   path exists** — not from an uploaded screenshot, an amount match, or a
   WhatsApp click.
3. **Customer data.** Names, addresses, phone numbers and payment proofs.
4. **Catalogue integrity.** Prices and stock.

## What this system never does

- Take card payments, or store card data. There is no gateway in Phase 1.
- Ask for a banking password, PIN or OTP. **A site asking for these is
  phishing** — there is no legitimate reason, and this one will never do it.
- Expose a private file through a public URL.
- Log a password, token, session id, full IBAN or secret.
- Trust a client-supplied price, total, stock figure, role or status.

## Practices

Zod validation at every boundary · parameterised queries only · server-side
authorisation on every endpoint · `SameSite` + `__Host-` cookies with origin
checks · strict CSP without `unsafe-inline` · rate limiting on authentication and
order tracking · Turnstile on high-risk forms when configured · magic-byte
validation on uploads · CSV formula-injection neutralisation on export ·
non-enumerable random tokens for public order tracking.

Full model: `docs/security-threat-model.md`.

## Two-factor authentication

TOTP is supported and is a **launch blocker** for super administrators, payment
verifiers, and anyone who can change payment identifiers.

## Secrets

Never committed. Local development uses `.dev.vars` (gitignored); deployed
environments use `wrangler secret put`. `npm run secret-scan` runs as part of
`npm run verify`.
