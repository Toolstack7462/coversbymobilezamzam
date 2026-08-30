# Repository audit — Phase 0

Recorded before any code was written. Everything below was verified by running a
command, not inferred.

---

## 1. Working directory

The Claude Code session opened in `C:\WINDOWS\system32`. **Nothing has been
written there.** That path is a Windows system directory and is not a repository.

| Path | Role |
|---|---|
| `C:\Users\User\italian-tech-atelier` | Existing Shopify reference project. **Read-only for this work.** |
| `C:\Users\User\italian-tech-atelier-commerce` | This project. Created empty in Phase 0. |

---

## 2. A git finding that changes how this repo is set up

`C:\Users\User` — the user's home directory — **is itself a git working tree**:

    $ git -C /c/Users/User rev-parse --show-toplevel
    C:/Users/User
    $ git -C /c/Users/User remote -v
    origin  https://gitlab.com/genz-group3/genz-3d-virtual-tours.git

That repository is unrelated to this project. Anything created under
`C:\Users\User` without its own `.git` would be picked up by
`genz-3d-virtual-tours`, and a careless `git add -A` there would commit a
merchant's commerce platform — eventually including order and payment
configuration — into a third party's virtual-tours repository.

**Decision:** this project gets its **own** `.git`, so it is an independent
repository with independent history. `git rev-parse --show-toplevel` from inside
the project now returns the project directory, which is the check that matters.

This is not the "nested repository" the brief warns against — that warning is
about creating a repo *inside* the project. Here the containment is an accident
of the home directory being a checkout, and giving the project its own repo is
what *prevents* the leak.

Verified before starting: the home repository does not track either project.

    $ git -C /c/Users/User status --porcelain -- italian-tech-atelier italian-tech-atelier-commerce
    ?? italian-tech-atelier/

Untracked. **No commit, stage, or configuration change has been made to the home
repository, and none will be.**

---

## 3. The Shopify reference project

`C:\Users\User\italian-tech-atelier` — a complete Shopify Online Store 2.0 theme.

| Property | Value |
|---|---|
| Branch | `main` |
| HEAD | `f1a7df6` |
| Working tree | clean (0 modified files) |
| Remote | `github.com/Toolstack7462/coversbymobiile.git` |

**It has been left exactly as found.** Not modified, not converted, not deleted,
no commits added, and no commerce code pushed to its remote.

### What is being reused, and on what basis

Everything below is project-owned — written for this merchant during that
engagement, or supplied by the merchant — so reuse carries no third-party claim.

| Asset | Reuse |
|---|---|
| Design tokens (`snippets/theme-tokens.liquid`) | Ported to `app/styles/tokens.css`, including the **WCAG-corrected** `--color-*-text` variants below. |
| Type scale, spacing scale, radii, motion tokens | Ported verbatim. |
| Inter + Manrope WOFF2 (4 files) | Copied. SIL OFL 1.1 permits self-hosting. |
| Italian and English interface copy | Harvested from `locales/it.default.json` / `en.json` as the seed for `app/locales/`. |
| Romanian and Arabic locales | Available, **not enabled in Phase 1** — see `docs/known-limitations.md`. |
| Compatibility resolution logic | The five-state model and its invariants are re-implemented as a typed pure domain function. |
| Device finder flow (brand → family → model) | Interaction design reused; implementation is new. |
| Product-card anatomy, badge priority rules | Reused as design decisions. |
| Accessibility findings | Reused directly — see below. |
| QA scenarios | Reused as the basis of the test matrix. |
| Documentation structure | Reused as a pattern. |

### Accessibility findings carried forward

The Shopify project's axe runs produced two measured contrast failures **in the
brief's own palette**, and the fix is inherited rather than rediscovered:

| Token | As text on porcelain | Verdict |
|---|---|---|
| `--color-success` `#15845A` | 4.40:1 | Fails AA (needs 4.5:1) |
| `--color-danger` `#D92D20` | 4.22:1 on its own tint | Fails AA |

Both are **correct as fills** (white on `#D92D20` is 4.83:1). The resolution was
to separate fill tokens from text tokens rather than alter the specified palette:
`--color-success-text: #147D56`, `--color-danger-text: #D02B1F`. That split is
carried into this project and is stated in `docs/accessibility.md`.

Also carried forward: interactive targets must be 44px (a 36px `.chip` regression
was caught there by a duplicated CSS rule), and RTL is done with logical
properties plus a `dir` attribute, not a mirrored stylesheet.

### What is deliberately *not* reused

| Not reused | Why |
|---|---|
| Any `.liquid` file | Liquid is Shopify's template language. This platform does not run it. |
| Shopify Skeleton scaffold remnants | Its licence restricts use to Shopify-interoperating themes. **This project is not one**, so no Skeleton-derived file may be copied here. |
| `config/settings_data.json` merchant values | See §4. |
| Ajax Cart / Section Rendering / Predictive Search integrations | Shopify platform APIs with no equivalent here. |

---

## 4. Merchant data — a deliberate divergence from the reference project

The Shopify project's `config/settings_data.json` contains values the merchant
supplied during that engagement: a shop name, phone, WhatsApp number, email, and
opening hours.

**This brief lists every one of those as unknown and not to be invented.** They
are therefore **not** copied into this project's code or seed data. Every
corresponding setting ships empty, and the storefront hides the feature that
depends on it.

The values are not lost — they exist in the reference repository and are recorded
as *candidates* in `docs/known-limitations.md` for the merchant to confirm and
paste into the admin panel. Confirming a value is the merchant's act, not the
build's assumption. Two things make this more than pedantry:

- The reference project itself flags an open question over whether **ZAM ZAM** is
  the *ragione sociale* or a second brand. That is unresolved, and the legal name
  is a compliance field under D.Lgs. 70/2003.
- The email held there is a personal Gmail address. Whether it is the business
  support address is the merchant's decision to state.

Only the **physical address and coordinates** are treated as known, because this
brief states them directly:

    Viale della Repubblica 8a, Centro Il Nuovo Borgo, negozio 6
    67039 Sulmona (AQ), Italy      42.0614846, 13.9200965

---

## 5. Environment

| Tool | Status |
|---|---|
| Node | v24.14.1 |
| npm | 11.11.0 |
| git | 2.54.0.windows.1 |
| GitHub CLI | 2.95.0 installed — **not authenticated** |
| Wrangler | not installed globally; added as a dev dependency |

**`gh auth status` reports no logged-in host.** Under the brief's rules this means
no remote may be invented and no password may be requested. All work is committed
locally; see `docs/deployment.md` for the exact command to run once authenticated.

---

## 6. Risks recorded at the outset

| Risk | Mitigation |
|---|---|
| Home directory is a foreign git repo | Project has its own `.git`; home repo left untouched. Recorded in §2. |
| Reference project could be damaged | Treated read-only. Its HEAD `f1a7df6` and clean tree are recorded above so any change is detectable. |
| Merchant data could be silently invented from the reference project | Explicitly refused; see §4. |
| Secrets committed | `.gitignore` blocks `.env`, `.dev.vars`, `*.key`, `.wrangler/`, databases, `uploads/`, `proofs/`. A `secret-scan` script gates `npm run verify`. |
| Personal data committed | Payment proofs and DB dumps are ignored paths and stored in a **private** R2 bucket, never the repo. |
