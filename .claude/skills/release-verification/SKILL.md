---
name: release-verification
description: What must actually pass before anything is called done, committed or pushed. Use before every commit and before any deployment claim.
---

# Release verification

## One command

    npm run verify

format check · lint · typecheck · locale parity · migration validation · unit ·
integration · security · build · budgets · secret scan.

## The honesty rules

**Nothing is described as verified, tested, committed, pushed or deployed unless
the corresponding command actually succeeded.**

- A failing test is reported as a failing test, with its output.
- A skipped step is reported as skipped.
- Do not claim Core Web Vitals without a deployed-preview measurement.
- Do not claim a backup works without a test restore having been performed.
- Do not claim a push succeeded without confirming the remote branch.

## Before a commit

1. `npm run verify` passes.
2. Review the actual diff.
3. Docs match what the code now does.
4. No secrets — check the diff, not just the ignore file.
5. A commit message that explains **why**.

## Before claiming a push

- `git remote -v` shows the intended remote
- the push command exited 0
- the remote branch is confirmed

If `gh` is not authenticated: complete the commits, say plainly that push is
blocked on authentication, and give the exact command. **Do not invent a remote.**

## Production

Never automatic. Never without explicit authorisation, every time. A git push and
a Cloudflare deploy are separate actions and neither implies the other.

## Status language

Until every launch gate has evidence, the status is
**READY FOR MERCHANT REVIEW** or **DO NOT LAUNCH**. Never "ready to launch".
