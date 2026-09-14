# Combined release — storefront and admin

Integration state for the two parallel workstreams. **Nothing here is merged to
`main` or deployed.** The final merge and live deployment need the user's
approval of a combined preview.

---

## 1. Where each workstream is

|                                               |                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Baseline both start from                      | `103fd13` (`main`, and the SHA currently live)                                    |
| Admin branch                                  | `feat/admin-ux-reliability` — see [admin results](../admin/refinement-results.md) |
| Storefront branch, per the brief              | `feat/storefront-motion-refresh`                                                  |
| Storefront branch, **actually on the remote** | **does not exist**                                                                |

### The named branch is not there

`git fetch --all --prune` lists no `feat/storefront-motion-refresh`. What does
exist, and is new, is:

```
feat/admin-english-storefront-locales   292f618   1 commit, 95 files, +6585/-1734
```

That branch is **1 commit behind `main`** and its name and contents straddle
the ownership line drawn for this work: it touches `package.json`,
`scripts/verify/budgets.mjs`, `app/styles/admin.css` and the locale files —
all of which this workstream is named sole writer of — as well as storefront
routes, which it is not.

It has **not** been merged, reviewed in depth, or integrated. Doing either
automatically would be exactly the "merge because its report says done" the
brief rules out, and it would silently take over files this workstream owns.
It needs a decision about whose it is before it moves.

### The integration request does not exist either

`docs/frontend/motion-refresh/integration-request.md` is absent from every
branch. §6 of the brief is explicitly gated on it: it is the document that says
which new CMS fields the storefront needs. Without it there is nothing to map,
and inventing fields would create the duplicate phone/address/brand settings
the brief forbids.

**So §6 and §8 are blocked on inputs, not on effort.**

---

## 2. Shared-file decisions taken

Only one shared file was changed, and only for a defect.

| File                        | Change                                                               | Why it is safe for the storefront workstream                                                                                                             |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/styles/app.css`        | `body` sets `background-color` instead of the `background` shorthand | Fixes a silent reset — see D-1. It makes a gradient that was always intended actually paint. **This is a visible change** and is flagged below.          |
| `app/styles/storefront.css` | one dead `flex-basis: 0` removed                                     | `flex: 1` below it already set basis to `0%`. Identical computed value, no visual change. Flagged because the file belongs to the storefront workstream. |

Untouched, deliberately: `app/root.tsx`, `app/styles/tokens.css`, the locale
files, `package.json`, the lockfile, and all server/deployment configuration.

### One thing the storefront workstream must decide

The `body` gradient now renders. It never did before, so the storefront has
only ever been seen on a flat fill.

The old comment also claimed the gradient was `background-attachment: fixed`
and skipped on touch. **No such rule has ever existed** in these stylesheets,
so that described behaviour the browser never had. It was removed rather than
implemented: whether the gradient should be fixed, and which colours it runs
between, is a theme decision, not a bug fix.

`tests/browser/style-cascade.spec.ts` deliberately asserts only that a gradient
paints, never which colours — so re-theming it will not fail the test.

---

## 3. When the storefront branch does appear

The order, and the parts that are not optional:

1. `git fetch`, then read the actual diff — not the report.
2. Branch `integration/premium-storefront-admin` from reviewed `main`.
3. Merge both reviewed branches; resolve shared files by understanding both
   sides, never `--ours`/`--theirs` across whole files.
4. Re-check every shared-file claim in §2 against what the storefront branch
   does to the same rules.
5. If Motion is requested: confirm the version's API, measure the real bundle
   cost against the storefront budget, keep the lockfile, and do not add a
   second animation library.
6. Full `npm run verify`, the browser suite with a wiped `.wrangler/e2e`, and
   `npm run build:hostinger` — never the Cloudflare build or `vite preview`.
7. Combined preview for approval. Only then a main merge.

**Budget warning for step 5.** Storefront JavaScript is at **135.0 KB of a
136.0 KB budget — 99%**. There is under 1 KB of headroom. Any animation
library, and most new customer-facing code, will breach it. The budget must not
be raised to accommodate a dependency; if Motion is wanted, the space has to
come from somewhere measurable first.

For reference, React 19.3.0 alone was measured at **+8.3 KB** on
`entry.client`, which is why that Dependabot PR is still open and red.

---

## 4. Deployment, unchanged

The live mechanism stays the SSH/Passenger release
(`npm run hostinger:deploy`). Hostinger's Git pipeline is static-only, fails on
every push, and never touches `current`. No competing deployer was created and
no secret, credential, media path or scheduled job was altered by this
workstream.

Rollback points already on the remote:
`pre-release/storefront-premium-2026-09-14` and
`pre-release/media-footer-admin-2026-09-15`.
