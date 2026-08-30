# Authentication and RBAC

## Authentication

Better Auth over D1. It owns its own tables; this project does **not**
hand-duplicate session or credential storage.

Supported: email/password · secure sessions · password reset (when email is
configured) · customer registration · **guest checkout** · staff-only admin
access · session revocation · password change · login rate limiting · Turnstile
on high-risk forms · optional TOTP two-factor.

### Guest checkout is not optional

An account is never required to buy. Forcing registration to complete a purchase
loses sales, and the order is identified by its number plus a random token
anyway. A customer may create an account afterwards.

### Password reset does not confirm account existence

The response is identical whether or not the email is registered. Otherwise the
reset form becomes an oracle for testing which addresses have accounts here.

### Two-factor

TOTP. A **launch blocker** for super admins, payment verifiers, and anyone able
to change payment identifiers — see `docs/security-threat-model.md`.

### Step-up authentication

Re-authentication within a short window, required for the highest-impact
actions regardless of an active session:

- changing IBAN, beneficiary or merchant payment identifiers
- verifying a payment
- changing payment-verification rules
- changing roles

These are the actions where a borrowed laptop or a stolen session cookie does the
most damage.

---

## Roles

Roles are **data**, not code. `roles`, `permissions`, `role_permissions` and
`user_roles` are tables, so the merchant can create a role without a deployment.
The seven below ship as defaults.

| Role                  | Can                                                                                                   | Cannot                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Super admin**       | Everything authorised                                                                                 | —                                                                          |
| **Catalogue manager** | Products, variants, descriptions, categories, media, compatibility, SEO                               | Verify payments · change payment identifiers · change roles · read secrets |
| **Price manager**     | Prices, promotions, price lists                                                                       | Verify payments · inventory · roles                                        |
| **Inventory manager** | Stock, receipts, transfers, corrections, thresholds                                                   | Prices · payments · roles                                                  |
| **Order manager**     | Orders, fulfilment, pickup, returns, customer communication                                           | Verify payments · payment identifiers · roles                              |
| **Payment verifier**  | Review claims, verify, reject, record partial/over payment                                            | Edit product cost · change payment account identifiers                     |
| **Store staff**       | Shop inventory, prepare pickup, record collection, counter-sale movements, necessary customer details | Full banking configuration · system settings · roles                       |

### Separations that are deliberate

**Payment verification is separate from order management.** The person who
creates and edits orders should not also be the one who declares them paid. This
is the ordinary separation of duties around money, and it is the reason
`payment.verify` is its own permission.

**Payment verifiers cannot change payment identifiers.** Verifying payments and
choosing where payments go are different powers. Someone holding both can
redirect money and then confirm it arrived.

**Store staff cannot see banking configuration.** Counter work does not require
the business IBAN.

---

## Permissions

Format `resource.action`:

    product.read   product.write   product.archive
    price.read     price.write
    inventory.read inventory.adjust inventory.transfer
    order.read     order.write     order.cancel     order.refund
    payment.read   payment.verify  payment.settings
    content.read   content.write   content.publish
    customer.read  customer.write
    staff.read     staff.write     staff.roles
    settings.read  settings.write
    audit.read
    import.run     export.run

`payment.settings` (where money goes) is separate from `payment.verify` (whether
it arrived), for the reason above.

---

## Enforcement

Every endpoint checks server-side:

    const actor = await requireStaff(request, "payment.verify");

**Hiding a menu item is not authorisation.** The UI hides what a user cannot do
as a courtesy; the server refuses it as the control. `tests/security/rbac.test.ts`
calls every admin endpoint with every role and asserts the matrix.

Loaders enforce read permissions too. An unauthorised user must not be able to
read admin data by requesting the route's data directly.

---

## Admin bootstrap

There is **no public admin registration**, and no default account with a known
password. Shipping either would be an open door.

`npm run bootstrap-admin` creates the first super admin. It refuses to run if any
staff user already exists, requires a password meeting policy, prints nothing
secret to stdout, and writes an audit entry.

---

## Sessions

HttpOnly, Secure, SameSite, `__Host-` prefixed. Rotated on privilege change,
revocable server-side, listed in the account area, explicit logout everywhere.

Admin sessions are shorter-lived than customer sessions, and step-up is required
again after the step-up window expires regardless of session age.
