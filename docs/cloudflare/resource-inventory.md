# Cloudflare resource inventory

Taken before creating anything, so that "did this already exist?" is answered by
a record rather than by a guess. Re-run the commands to refresh it.

**Account:** Genzdigitaltools7462@gmail.com's Account
**Account ID:** `1f6bb6609180713e4b6bf9efc2f864d1`
**Authenticated as:** `genzdigitaltools7462@gmail.com` (OAuth)
**Taken:** 2026-08-31

This account is named for a different business. It is the only account on this
login, so there is no ambiguity about which account is selected, and the choice
to use it was confirmed explicitly rather than assumed from the name.

---

## Before this milestone

    npx wrangler d1 list          →  []           (no databases)
    npx wrangler r2 bucket list   →  error 10042  (R2 not enabled on the account)
    npx wrangler deployments list →  error 10007  (no Worker named ita-commerce)

**A completely clean account.** No name collisions, no resources belonging to
unrelated projects, and therefore no question of proving ownership of an
existing resource before reusing it.

R2 had never been enabled. It was enabled from the dashboard by the account
owner during this milestone; Cloudflare requires a payment method on file even
for the free 10 GB tier, which is why it could not be done from the CLI.

---

## Created by this milestone

| Kind   | Name                                    | Jurisdiction | Purpose                  |
| ------ | --------------------------------------- | ------------ | ------------------------ |
| D1     | `ita-commerce-preview-db`               | `eu`         | Preview relational data  |
| R2     | `ita-commerce-preview-media`            | `eu`         | Product images (private) |
| R2     | `ita-commerce-preview-proofs`           | `eu`         | Payment proofs (private) |
| Worker | `italian-tech-atelier-commerce-preview` | —            | Preview application      |
| D1     | `ita-commerce-preview-restore-test`     | `eu`         | Disposable restore drill |

Nothing else on the account was created, modified or deleted.

`ita-commerce-preview-restore-test` is **disposable**. It exists to prove that
a backup can be restored (`docs/backup-and-fts-restore.md`) and currently holds
a restored copy of the preview demo catalogue. It holds no real customer data,
and it should be deleted once the drill is no longer being repeated:

    npx wrangler d1 delete ita-commerce-preview-restore-test

**EU jurisdiction** was chosen for all four: the merchant and their customers
are in Italy, and a jurisdiction is set at creation and cannot be changed
afterwards. Getting it wrong would mean recreating the resource and moving the
data.

---

## What deliberately does NOT exist

No production Worker, database or bucket. No staging resources. No custom
domain, no route, no DNS record. The `production` and `staging` environments in
`wrangler.jsonc` still carry placeholder database IDs, which is what made an
accidental base deploy fail safely rather than succeed against the wrong
target — see `preview-deployment.md`.
