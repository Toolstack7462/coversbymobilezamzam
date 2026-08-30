# Manual payments

The website **never takes money**. It records a precise order, holds stock, and
hands the customer to a human to settle payment outside the site.

---

## What the customer is told

The final action is **"Conferma l'ordine"** — never *"Paga ora"*, because nothing
is being paid on the site and the button must not imply otherwise.

Before confirming, prominently:

> Il pagamento non verrà effettuato sul sito. Riceverai le istruzioni per
> completarlo tramite WhatsApp.

---

## Methods

All are records in `payment_methods`, all admin-configurable, and **all ship
disabled** because none can be configured without merchant data that does not
exist yet.

| Method | Enabled when |
|---|---|
| SEPA bank transfer | Business IBAN and beneficiary are set |
| Instant SEPA transfer | Business IBAN and beneficiary are set |
| Satispay Business | Merchant identifier and instructions are set |
| BANCOMAT Pay | **Real merchant activation** is confirmed — see below |
| Pay at pickup | Store details, pickup rules and a reservation window exist |
| Generic manual method | Merchant defines it entirely |

**A method that is not fully configured is never advertised.** Half-configured
payment instructions are worse than none: the customer sends money somewhere
wrong, and the shop owns the problem.

### Never a personal account

The default destination must be a **business** account. A personal IBAN or a
personal Satispay account used for business receipts creates tax and traceability
problems for the merchant that are not this system's to create. The admin says so
at the point of configuration.

---

## Bank transfer

Shown after order creation, once configured:

- Beneficiary
- Business IBAN
- Exact amount
- **Causale: `ITA-20260830-AB12CD`** — mandatory, the order number
- Instructions

The *causale* is what makes reconciliation possible. Without it, staff are
matching an amount and a surname against a bank statement.

**Never requested:** banking password, PIN, OTP, card number, CVV. A site asking
for these is indistinguishable from phishing, and no legitimate reason exists.

---

## Satispay Business

A configurable manual method. **No API integration in Phase 1.**

Configurable: merchant display name, merchant identifier, QR image, customer
instructions, reservation window, shipping/pickup eligibility.

Fees are not hardcoded — they are a commercial matter between merchant and
provider, and a number baked into a codebase goes stale silently.

Staff verify in the actual Satispay Business app or dashboard before marking
verified. There is no other path.

---

## BANCOMAT Pay

**Disabled by default, and it stays disabled until real merchant activation
exists.**

The trap: BANCOMAT Pay supports person-to-person transfers, so it *looks* usable
without any merchant relationship. Person-to-person capability is not merchant
acceptance. Using it that way misrepresents the transaction and creates the same
personal-account problems as above.

Branding is not displayed until a legitimate configured merchant method exists.

---

## Pay at pickup

*"Pagamento al ritiro"* — available only when store pickup is configured, store
information is complete, pickup stock exists and a reservation window is set.

Pay-at-pickup orders **still reserve stock**. Staff record collection and payment
receipt together in one authorised action.

### The fiscal boundary — read this

This system manages inventory and internal order state. It **does not** replace
Italy's required fiscal process: *registratore telematico*, *documento
commerciale*, and the daily transmission of *corrispettivi*.

Nothing here should be read as making the shop's counter compliant. That is a
matter for the *commercialista*, and it is on the launch checklist as a blocker.

---

## Payment proof upload

**Optional.** A customer may equally just send a message on WhatsApp.

If used: private R2 bucket · short-lived presigned upload · order-scoped
authorisation · MIME, extension, size and magic-byte validation · random object
key (the original filename is never trusted) · server-side finalisation · only
the private key stored · short-lived authorised staff downloads · access logged ·
retention-policy deletion.

Accepted: JPEG, PNG, WebP, PDF.

**An uploaded screenshot never changes payment status.** It moves the order to
`proof_received`, which means "there is something for a human to look at".

---

## Verification queue

Admin → Payments → Verification Queue. Shows order number, customer, method,
amount expected, amount claimed, amount received, currency, reference, proof
status, reservation expiry, current status, age.

Actions: mark proof received · begin verification · **verify** · reject · record
partial · record overpayment · request clarification · extend reservation ·
cancel · release reservation · add internal note.

Verification requires step-up auth, an amount received, and a reference or a
stated reason. `payment.verify` is a distinct permission — catalogue staff do not
have it.

Duplicate references are **flagged for human review**, never auto-rejected.

---

## Encryption of merchant identifiers

IBAN and equivalent identifiers are encrypted at rest with AES-GCM using
`SETTINGS_ENCRYPTION_KEY`, held as a Cloudflare secret.

A masked form (`IT** **** **** **** **** 1234`) is stored alongside for display,
so ordinary admin screens never decrypt. Full values are decrypted only when
rendering payment instructions, and are **never logged**.

Changing an IBAN or beneficiary requires step-up authentication and is audited.
An attacker who can quietly change the destination IBAN redirects every future
payment, which makes this the highest-value target in the application.
