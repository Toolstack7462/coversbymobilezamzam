# Initial administrator bootstrap

How the very first administrator is created, and why the obvious approach was
wrong.

---

## The bug this replaces

The original guard was:

    if ((await staffCount(env)) > 0) throw 404;
    // ... create the user

That is a **read followed by a write**. Two requests arriving together can both
read zero and both proceed, producing two administrators from a route that is
meant to produce exactly one. The window is small, but it is not zero — and a
setup route is exactly the kind of URL that gets double-clicked, retried on a
flaky connection, or hit twice by a link preview.

It is the same class of bug as the inventory oversell, and it has the same
shape of fix: make the database arbitrate.

---

## The lock

    CREATE TABLE installation_state (
      id                   TEXT PRIMARY KEY,
      status               TEXT NOT NULL,
      claimed_at           INTEGER NOT NULL,
      completed_at         INTEGER,
      completed_by_user_id TEXT,
      token_consumed_at    INTEGER,
      CHECK (id = 'singleton'),
      CHECK (status IN ('in_progress','completed'))
    );

`id` is CHECK-constrained to the literal `'singleton'`, so **the PRIMARY KEY is
the mutex**. There can only ever be one row.

The claim is a single statement:

    INSERT INTO installation_state (id, status, claimed_at, token_consumed_at)
    VALUES ('singleton', 'in_progress', :now, :now)
    ON CONFLICT(id) DO UPDATE
      SET claimed_at = :now, token_consumed_at = :now
    WHERE installation_state.status = 'in_progress'
      AND installation_state.claimed_at < :stale

It does exactly one of three things, atomically:

- **claims fresh** — no row existed;
- **reclaims a stale attempt** — a row exists, is `in_progress`, and is older
  than 15 minutes;
- **affects nothing** — someone holds a live claim, or installation completed.

`meta.changes === 0` means "you lost", and the caller stops. Crucially the claim
is taken **before** the account is created, so the loser never reaches account
creation at all.

---

## Order of operations, and why

1. **Rate limit** — cheapest first, and it is what stops the token being
   brute-forced.
2. **Token check** — constant-time, before any write.
3. **Atomic claim** — the step above.
4. **Create the account** — through Better Auth's own `signUpEmail`.
5. **Staff profile + role grant + completion marker** — one D1 batch.
6. **On failure** — release the claim.

Step 5 is a single batch on purpose. A user with no staff profile, or a staff
profile with no role, is a half-installed system that _looks_ finished.

---

## The setup token

`INITIAL_ADMIN_SETUP_TOKEN`, a Cloudflare secret, minimum 24 characters.

**Without it the route refuses to run.** It does not fall back to "no token
required" — a bootstrap endpoint that opens when unconfigured is a back door,
and the failure mode of a misconfigured deploy should be _closed_.

| Rule                                    | Implementation                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Never in the repository                 | It is a secret, set with `wrangler secret put`                                                                                               |
| Never in a URL                          | Submitted by POST only                                                                                                                       |
| Never in logs                           | Never passed to any logger; only the _outcome_ is recorded                                                                                   |
| Never in rendered HTML after submission | The field is `type="password"` and the value is never written back — a rejected attempt returns an empty field rather than echoing the guess |
| Never stored                            | `token_consumed_at` records _when_ a token was accepted, never _what_ it was                                                                 |

Comparison is **constant time**. `a === b` short-circuits on the first differing
byte, which leaks the length of the correct prefix to anyone timing responses.
workerd has no `crypto.timingSafeEqual`, so the comparison XORs every byte and
never returns early.

---

## Rate limiting

Failed attempts are recorded in `bootstrap_attempts`. Five failures from one
source in fifteen minutes locks that source out — **including with the correct
token**. Guessing must not be cheap, and a lockout that a correct guess escapes
is not a lockout.

The source IP is stored **hashed** (SHA-256 over `secret:ip`, truncated). Rate
limiting needs to recognise a repeat visitor, not identify one, and an unhashed
address on an unauthenticated endpoint is personal data nobody needs.

---

## Turnstile

Applied when `TURNSTILE_SECRET_KEY` is configured, verified **server-side**
against siteverify. A token that only passes in the browser proves nothing.

When Turnstile is not configured the route still works — the token and the rate
limit are the real controls.

---

## Recovery

Two failure modes, handled differently:

**Account creation failed** (bad email, weak password, duplicate address).
Nothing was created, so the claim is **released**. Holding it would strand the
whole installation on a typo.

**The batch failed after the account was created.** The claim stays
`in_progress` and becomes reclaimable after 15 minutes. The orphaned Better Auth
user holds **no privileges at all** — staff access is the presence of a
`staff_profiles` row plus a role, neither of which exists. It is a customer
account with an unused address.

**A Worker died mid-install.** Same path: the stale claim is reclaimable after
15 minutes.

In every case the invariant holds: at most one administrator is created.

---

## After installation

- `isInstalled()` returns true.
- The route returns **404** from both the loader and the action — the action
  re-checks, so a stale form cannot be replayed against it.
- The token is spent. Delete it from the environment.
- The new administrator is redirected straight to **TOTP enrolment**, which is
  mandatory for their role.

---

## Tests

`tests/security/bootstrap.test.ts` — 16 tests:

- exactly one administrator from **two** simultaneous requests
- exactly one from **five** simultaneous requests
- exactly one role grant under concurrency
- wrong token rejected, **and nothing written** (no claim taken)
- fails closed when no token is configured
- refuses a token too short to be high-entropy
- the token appears in no table, in any form
- replay after completion refused
- completion records who and when
- claim released on account failure, so a retry succeeds
- no half-installed state when the batch fails
- a **stale** claim is reclaimable
- a **live** claim is not
- rate limit locks out after five failures, correct token included
- the source is stored hashed, never in the clear
