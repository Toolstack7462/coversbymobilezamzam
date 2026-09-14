# Admin fixes — September 2026

What changed, and why each change is the shape it is. The findings themselves
are in `docs/admin-audit.md`; the test procedure is in `docs/admin-qa.md`.

---

## 1. One password field for the whole admin

`app/components/admin/password-field.tsx`

### What it replaced

Twelve `type="password"` inputs across nine screens, each written separately,
none revealable:

| Screen                      | Field                                      |
| --------------------------- | ------------------------------------------ |
| `login.tsx`                 | sign-in password                           |
| `setup.tsx`                 | setup token, new password, confirmation    |
| `staff-accept.tsx`          | new password, confirmation                 |
| `staff.tsx`                 | step-up before managing staff              |
| `payments.tsx`              | step-up before verifying a payment         |
| `settings.tsx`              | step-up before editing payment details     |
| `security-2fa.tsx`          | step-up before disabling the second factor |
| `security-2fa-setup.tsx`    | step-up before enrolling                   |
| `security-backup-codes.tsx` | step-up before regenerating recovery codes |

Every `autocomplete` was already correct, which is worth saying: the problem was
not carelessness, it was twelve copies of a control that had never been given a
reveal.

### Decisions worth defending

**It wraps `FormField` rather than reimplementing it.** The label, required
marker, hint and error keep behaving exactly as they do on every other admin
field, and there is one place to change them.

**The toggle is a sibling of the input, not an overlay.** The usual
implementation absolutely-positions the button inside the input's right edge —
which is exactly where Chrome, Safari and every password manager put _their_
icon. A flex row cannot overlap anything, gets a 44px tap target for free, and
leaves the input's padding alone. On a screen narrower than 28rem the button
drops beneath the input and spans the width, which makes the target bigger
rather than smaller.

**It never asks the server for anything.** Revealing is a `type` change on a
value the person just typed. A browser test asserts that toggling produces zero
network requests, because "show password" is precisely the feature somebody
eventually implements by fetching the stored value — and the only stored value a
server could return is a hash, so the version that "works" is the one that kept
the plaintext.

**It stores nothing.** No `localStorage`, no URL, no analytics. Visibility lives
in component state, so a reload always comes back masked, and a unit test scans
every component and route for a password near a storage call.

**It re-masks on three events**: pressing Hide, the page becoming hidden
(`visibilitychange`), and form submission. The third was found by its own test —
see §2 below.

**The caret survives the toggle.** Switching between `password` and `text` sends
the caret to the end in WebKit and drops the selection in Chromium. Somebody who
reveals a password to check one character in the middle of it should not have to
find their place again. This is why the spec runs in all three engines.

**Caps Lock is announced, not just drawn.** The live region is in the DOM from
first render and filled later, because a region that appears at the same moment
as its content is announced unreliably. Not verified with a screen reader — see
the audit's "not verified" section.

### The one field that is not a password

The first-run setup **token**. It is masked, so it has the same problem: the
token is long, pasted from a terminal or a password manager, and a paste that
silently truncated produces exactly the same "Token non valido" as a wrong
token. Being able to look at what was actually pasted is the difference between
fixing that in seconds and reinstalling.

It carries `autocomplete="off"`, not a password value: it is a one-time
environment secret and a password manager must not offer or store it as an
account credential. The `autoComplete` prop is a required union of exactly three
values, so this cannot be got wrong by omission.

### What deliberately did NOT get a reveal

**The stored payment identifier.** `settings.tsx` selects only
`account_identifier_masked`, stores `account_identifier_encrypted`, and audits
the masked form. A generic Show/Hide applied to "anything that looks secret"
would turn a saved IBAN into something any staff member with settings access can
read. A browser test asserts no reveal control names that field.

---

## 2. Defects fixed

### The received payment amount, in euro (P1)

`app/routes/admin/payments.tsx`. Was labelled "(centesimi)", `type="number"`,
prefilled `3490`, read with `Number()`. A merchant recording a partial payment
of ten euros typed `10` and recorded ten cents. Now reads euro through
`parseAmountToMinorUnits` and refuses an unreadable amount by name.

`type="text"` with `inputMode="decimal"`, because a number input refuses the
comma in some browsers and the comma is how the amount is written here.

### A revealed password survived a rejected sign-in (P1)

Found by the test, not by reasoning. React Router re-renders the _same_
component on the action's error, so `visible` survived — leaving a rejected
password legible on the screen where somebody is most likely to give up and walk
away. The field now re-masks on submit, via a listener on `element.form` rather
than an `onSubmit` prop every caller must remember: the one that forgot would be
the one that leaked.

### An unreadable stock figure became zero (P2)

`app/routes/admin/product-detail.tsx`. `Number(...) || 0` turned `12 pezzi` into
a variant silently holding no stock. Now `Number.isInteger` or a refusal, like
the two inventory screens next door.

---

## 3. Supporting changes

### `app/styles/admin-forms.css` (new)

The form CSS moved out of `admin.css` and lost its `.ac` scope.

Login, first-run setup and invitation acceptance are registered **outside**
`routes/admin/layout.tsx` — the shell that requires a staff session cannot wrap
the page that creates one — so they never loaded `admin.css` at all. A
PasswordField on the login page rendered with an unstyled label and a toggle
that did not sit beside its input.

Every class in the file is `ac-`-prefixed and used only by `app/components/admin`,
so de-scoping cannot reach a storefront element. Loaded by the admin layout and
by the three pre-auth routes; not in the storefront bundle.

### `app/domain/users/password-policy.ts` (new)

`MIN_PASSWORD_LENGTH` had been written twice — once in Better Auth's config and
once as `minLength={12}` in two forms. Two copies of a number are one number
that will eventually disagree with itself, and the bad direction is the likely
one: a form promising "at least 8" while the server demands 12 produces a
rejection the person cannot act on.

Now one constant, imported by both. The forms also state the rule _before_
submission, rather than teaching it by rejection. The claim in that copy — that
the password is not altered in any way — was checked before it was written:
nothing trims, lowercases or truncates a password anywhere in the codebase.

### `scripts/verify/budgets.mjs`

The budget classified the two new admin-only chunks as storefront, pushing the
customer's budget from 97% to 99% without a single customer-facing byte joining
it.

It read a hand-written list of three component names, under a comment conceding
that "an admin-only helper that nobody remembered to list here is also charged
to them". That is exactly what happened. It now reads `app/components/admin/`,
the same way it already reads `app/routes/admin/`.

**The budget itself is unchanged.** Storefront went 132.5 → 132.0 KB and the
total is identical at 219.0 KB — the weight moved columns, it did not vanish.
The claim underneath was checked: nothing outside `app/routes/admin/` imports
from `app/components/admin/`.

### Test isolation

Two faults, both mine to the extent that adding tests exposed them:

- The conflict test and the product-type template test both write the Cavo USB-C
  product, and the conflict test ran on **both** projects. A save could be
  refused by the very guard the other test was proving works, surfacing as a
  stale value that looked like a broken save. Now desktop-only, like every other
  shared-row test in that file.
- The password spec wanted the payments step-up form _unsatisfied_ while the new
  payment test satisfies it. It now uses the recovery-codes confirmation, which
  nothing submits; the payments step-up reveal is asserted inside the helper
  that legitimately meets that form. (The 2FA disable screen was tried first and
  rejected: its form renders only when the second factor is optional, and it is
  mandatory for this role.)
