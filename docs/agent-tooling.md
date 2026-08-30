# Agent tooling

What was actually available in this environment, what was used, what was created,
and what was refused. Verified by inspection — nothing here is assumed.

Updated at the end of each phase. Phase 0 recorded the audit; later phases record
what was created.

---

## 1. Plugins — audit result

Read from `~/.claude/settings.json` and `~/.claude/plugins/`.

| Plugin                                  | Source                                      | Status                                                        |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `cloudflare@cloudflare`                 | `github:cloudflare/skills`                  | **Already installed and enabled**                             |
| `skill-creator@claude-plugins-official` | `github:anthropics/claude-plugins-official` | **Already installed and enabled**                             |
| `vercel@claude-plugins-official`        | `github:anthropics/claude-plugins-official` | Installed. **Not used** — this project deploys to Cloudflare. |

Both plugins the brief asked for were already present, from the exact publishers
it named. **No plugin was installed**, so no install-time trust decision arose.

**No third-party plugin was installed.** None was needed, and the brief's bar —
identify the publisher, inspect the manifest, inspect hooks and MCP access, reject
anything asking for more than it needs — is not worth clearing for a convenience
that adds nothing.

### MCP servers available

| Server                                                                                   | Used                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cloudflare-docs`                                                                        | **Yes** — to confirm the React Router v8 + Workers Vite integration rather than write it from memory. |
| `cloudflare-api`, `cloudflare-bindings`, `cloudflare-builds`, `cloudflare-observability` | No. All require OAuth, and none was performed — see §5.                                               |
| Nimble, Consensus, Canva, Notion, Google Drive, Vercel                                   | No. Not relevant.                                                                                     |

---

## 2. Skills — audit result

### Already installed at user level

| Skill                   | Used                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `ui-ux-pro-max`         | **Yes** — design-system pass and final visual QA, per the brief. |
| `impeccable`            | Available.                                                       |
| `design-taste-frontend` | Available.                                                       |
| `emil-design-eng`       | Available.                                                       |

`ui-ux-pro-max` **is** installed, at `~/.claude/skills/ui-ux-pro-max/`. It was
therefore used, not recreated — the brief's fallback (write a project-local
`ui-ux-commerce`) did not apply. Its recommendations were treated as input and
not followed where they would have cost accessibility, performance or
originality; any such divergence is noted in `docs/design-system.md`.

### Bundled commands — what actually exists here

The brief listed `/doctor`, `/debug`, `/code-review`, `/batch`, `/loop`. Verified
against this install:

| Command                       | Present                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `/code-review`                | Yes — used in Phase 9.                                  |
| `/security-review`            | Yes — used in Phase 9.                                  |
| `/loop`                       | Yes. Not needed.                                        |
| `/doctor`, `/debug`, `/batch` | **Not present in this install.** Not claimed, not used. |

`/skill-doctor` and `/skill-creator` are available via the skill-creator plugin.

---

## 3. Project-local skills created

Written to `.claude/skills/`. Each is project-specific, carries no credentials,
contains no destructive script, and deliberately avoids restating `CLAUDE.md`.

| Skill                          | Covers                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `commerce-domain-architecture` | Layer boundaries, ports and adapters, where a rule is allowed to live.                    |
| `cloudflare-commerce`          | D1 conditional writes, batch semantics, R2 split, cron, bindings.                         |
| `ui-ux-commerce`               | The design system as enforceable rules. Complements `ui-ux-pro-max`; does not replace it. |
| `mobile-device-compatibility`  | The compatibility model and its invariants.                                               |
| `inventory-and-reservations`   | Ledger discipline and the oversell-prevention pattern.                                    |
| `manual-payment-workflow`      | Why nothing but a human may mark an order paid.                                           |
| `ecommerce-security`           | The threat model as a checklist.                                                          |
| `accessibility-wcag22`         | WCAG 2.2 AA rules that this codebase can actually break.                                  |
| `core-web-vitals`              | Budgets and the techniques that hold them.                                                |
| `migration-safety`             | Forward-only migrations, backfills, the incomplete-change rule.                           |
| `visual-qa`                    | Screenshot matrix and what to look for.                                                   |
| `release-verification`         | What `npm run verify` must prove before anything is called done.                          |

---

## 4. Subagents created

Written to `.claude/agents/`. **All are read-only reviewers** — they report, and
fixes are applied in one place afterwards, so two agents can never edit the same
file concurrently.

| Agent                     | Scope                                                     |
| ------------------------- | --------------------------------------------------------- |
| `architecture-reviewer`   | Layer violations, duplicated rules, domain purity.        |
| `database-reviewer`       | Schema, indexes, constraints, migration safety.           |
| `security-reviewer`       | Threat model coverage, authz, injection, upload handling. |
| `accessibility-reviewer`  | WCAG 2.2 AA against real markup.                          |
| `performance-reviewer`    | Bundles, query plans, render strategy.                    |
| `ui-consistency-reviewer` | Token usage, spacing, states, Italian label overflow.     |
| `test-coverage-reviewer`  | Invariants that no test currently pins.                   |
| `release-reviewer`        | Final gate against the launch criteria.                   |

---

## 5. Security decisions taken

| Decision                               | Reason                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No plugin installed                    | Both required plugins were already present. Nothing else earned the trust cost.                                                                            |
| No Cloudflare MCP authentication       | Those servers can mutate a live account. The brief forbids automatic production resource creation, so authenticating buys nothing and widens blast radius. |
| No production deploy                   | Explicitly out of scope without separate authorisation.                                                                                                    |
| No secret read or written by any agent | Reviewers are read-only; `.dev.vars` and `.env` are gitignored and were never created with real values.                                                    |
| Hooks kept non-destructive             | See below.                                                                                                                                                 |
| `gh` left unauthenticated              | It was found unauthenticated. Authenticating is the user's action; the brief forbids requesting credentials.                                               |

### Hooks

`.claude/settings.json` defines format and lint checks on write. **No hook
deletes, moves, pushes, deploys or runs a database command.** A hook runs
automatically and without confirmation, so anything with side effects beyond the
working tree does not belong in one.

---

## 6. Tools that were not available

Recorded so nothing here is mistaken for something it is not:

- **No Shopify MCP** — irrelevant; this platform is not Shopify.
- **No Playwright MCP** — browser tests run through the Playwright test runner.
- **`gh` is installed but not authenticated** — see `docs/deployment.md`.
- **`/doctor`, `/debug`, `/batch` do not exist in this install.**
