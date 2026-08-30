# ADR 0010 — Git and release process

**Status:** Accepted · 2026-08-30

## Context

The merchant owns the git history. This project sits inside a directory that is
itself an unrelated git working tree (see `docs/repository-audit.md` §2), and the
merchant already has a GitHub repository holding their Shopify theme.

## Decision

**Own repository.** This project has its own `.git`, independent history, and its
own remote — `italian-tech-atelier-commerce`, private.

It is **not** pushed into `Toolstack7462/coversbymobiile`. That repository holds
the Shopify theme, which only works if `layout/`, `sections/` and `templates/`
sit at its root; adding a full application there would break the theme and tangle
two unrelated deployment paths in one history.

**Branch `main`.** Coherent milestone commits, one per phase. Never force push,
never rewrite shared history, never commit secrets, never push failing code.

**`git push` and Cloudflare deploy are separate actions.** Pushing source is not
releasing software, and neither implies the other. Production deployment requires
explicit authorisation every time.

## Alternatives considered

**Push into the existing theme repository.** Requested at one point, and
reconsidered on the structural grounds above. Rejected with the merchant's
agreement.

**A `commerce` branch in the theme repository.** Rejected: switching branches
would swap the entire codebase, CI would need to be branch-aware, and the two
projects would confuse anyone arriving later.

**Trunk-based with short-lived feature branches.** Sensible for a team. Overkill
for the current single-contributor reality; adoptable later without changing
anything.

**Auto-deploy on push.** Rejected explicitly. A push that reaches a live store
means a mistake reaches customers at commit speed, and the brief forbids
automatic production deployment.

## Consequences

**Good.** Clean independent history. The theme repository keeps working. Separate
access control. Source control and release are decoupled, so a push is always
safe.

**Bad.** Two repositories to keep track of. Deployment is a deliberate manual
step.

## Current state

**`gh` is installed but not authenticated**, so no remote is configured yet. Per
the brief, no remote has been invented and no credentials were requested. All
work is committed locally.

Once authenticated, from the project root:

    gh auth login
    gh repo create italian-tech-atelier-commerce --private --source . --remote origin --push

Run only when `gh auth status` succeeds, no conflicting remote exists,
`npm run verify` passes, and the secret scan is clean.

**Nothing is described as pushed until the remote exists, the push command
succeeds, and the remote branch is confirmed.**
