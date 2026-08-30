---
name: manual-payment-workflow
description: Manual payment rules. Use when touching payment methods, the verification queue, payment proofs, or anything that could change payment status.
---

# Manual payment workflow

## The rule everything else serves

**Only an authorised human may mark an order paid**, after checking the real bank
account or merchant app.

Not a screenshot. Not a matching amount. Not a WhatsApp click. Not a customer
saying so. A screenshot is an image and says nothing about settlement.

`verified` requires: an authenticated user with `payment.verify`, valid step-up
auth, an amount received, and a reference or an explicit stated reason.

## Never build

- An automatic transition to `verified` from any source.
- A path where uploading a proof changes payment status beyond `proof_received`.
- Auto-rejection of duplicate references. Duplicates are often legitimate; flag
  for human review.
- A "Paga ora" button. The site takes no money. The button is
  **Conferma l'ordine**.

## Configuration gates

Every payment method ships **disabled** and stays disabled until its merchant
data exists. A half-configured method sends money to the wrong place.

Never default to a personal IBAN or personal Satispay account for business
receipts.

BANCOMAT Pay stays off until real merchant activation exists. Person-to-person
capability is not merchant acceptance.

## Sensitive identifiers

IBAN and merchant identifiers are AES-GCM encrypted at rest. A masked form is
stored alongside so ordinary screens never decrypt. **Never logged.** Changing
one requires step-up auth and is audited.

An attacker who can quietly change the destination IBAN redirects every future
payment. Treat this as the highest-value target in the application.

## Proofs

Private bucket, random key, magic-byte validation, short-lived authenticated
reads, access logged, no public URL, ever.

## Fiscal boundary

This system manages inventory and order state. It does **not** replace the
registratore telematico or the corrispettivi process. Never imply otherwise.
