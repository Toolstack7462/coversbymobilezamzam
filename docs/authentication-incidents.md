# Three bugs that made the shop unusable

Found on 2026-08-31, the first time a browser test tried to install the shop and
sign in. All three were in the authentication path. Together they meant the
application could not be installed, and that if it somehow were, nobody could
get into it.

This document exists because each one is a category, not an accident, and the
categories will recur.

---

## What was broken

### 1. Installation could never complete

`account.issuer` did not exist.

Better Auth 1.7 scopes account identity by issuer and treats `issuer` as a
**required** field on the `account` table. Our Drizzle schema did not declare
it, so `signUpEmail` threw before writing anything:

    The field "issuer" does not exist in the "account" Drizzle schema.

The install page caught the throw and reported _"Impossibile creare l'account.
Controlla che l'email non sia già registrata."_ — which is the correct message
to show a merchant, and which points whoever is debugging it at entirely the
wrong thing.

Fixed by migration `0004_account_issuer.sql`, which adds the column and
backfills it from `provider_id` as Better Auth's own upgrade guide prescribes.

### 2. Enrolling in two-factor locked you out forever

`two_factor.verified` is **this project's own column**, not one Better Auth
maintains. It exists so `requireEnrolledStaff` can tell "has a secret" from "has
proved they can use it".

The access gate read it. Nothing wrote it.

So a super admin could enrol, see a success screen, receive recovery codes —
and then be refused by the gate on every single admin page, forever, with the
interface insisting they still needed to enable two-factor.

Fixed in the enrolment route: a successful `verifyTOTP` now sets `verified = 1`
and clears the failure counter and lockout, in the same batch as its audit row.

### 3. Every correct two-factor code was rejected

`Response.headers.get("Set-Cookie")` returns **one** value. `Set-Cookie` is the
one header that legitimately repeats, and the Headers API deliberately does not
join them, because a cookie's `Expires` attribute contains a comma.

Five auth routes read it with `.get()`. Signing in to an account with
two-factor enabled sets both a session cookie and a two-factor challenge
cookie; only the first survived. The challenge page therefore had nothing
identifying which challenge it was answering, and refused every code with
_"Codice non valido o scaduto."_ — sending the merchant to check their phone's
clock for a problem that was on the server.

Fixed by `app/infrastructure/auth/cookies.server.ts`, which uses
`getSetCookie()` and is now the only place this question is answered.

### 4. The system-health page returned 500

A query used `?1` and never bound it. D1 rejected the statement, and the screen
whose entire job is to tell the merchant that something is wrong was itself the
thing that was wrong.

---

## Why nothing else caught them

Each of these typechecked, built, linted and passed 324 unit and 164 integration
tests.

- **TypeScript could not see them.** Drizzle's schema and Better Auth's
  expectations are connected only at runtime. Raw SQL is a string. `Headers.get`
  returning one value of many is a correct call with a wrong meaning.
- **The unit tests never touched auth.** They cover pure domain logic, which is
  the right thing for them to cover.
- **The integration tests seeded staff rows directly.** Faster, and it meant no
  test ever signed anybody up. The fixture's convenience was hiding the bug.
- **The error messages were correct for a merchant and useless for a
  developer.** Deliberately vague auth failures are good security and terrible
  diagnostics; that trade is worth making, and it raises the cost of not having
  a test that uses the real front door.

---

## What now guards each one

| Guard                                   | Catches                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `tests/integration/auth-schema.test.ts` | The next missing Better Auth column, at upgrade time, naming it                      |
| the same file's credential-flow tests   | Sign-up, session issue and read-back actually working                                |
| `tests/browser/auth.setup.ts`           | The whole first run: install, log in, enrol, answer a challenge, reach the dashboard |
| `tests/browser/admin.spec.ts`           | Every admin screen rendering, with axe and a sidebar sweep                           |
| `tests/unit/totp.test.ts`               | The test helper itself, against the RFC 6238 vectors                                 |

The browser suite is not in `npm run verify` — it needs a build, a migrated
database and about three minutes. It runs separately, and `verify` says plainly
what it does not cover.

---

## The general lesson

**A test that seeds its way past the front door cannot tell you the front door
is locked.**

Every one of these bugs sat in the gap between components that were each
individually correct. The integration tests were right to insert staff rows —
that is what makes them fast — but the consequence was that the single most
important path in the application, the one every merchant walks exactly once,
was never executed until something opened a browser and typed into the form.
