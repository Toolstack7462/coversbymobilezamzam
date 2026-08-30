## What and why

<!-- What changed, and why it needed to. -->

## Verification

- [ ] `npm run verify` passes
- [ ] Tests added or updated for the behaviour that changed

## Change-safety checklist

Tick what applies; delete what does not. Full policy: `docs/change-management.md`.

**Database**
- [ ] Migration committed
- [ ] Drizzle schema types updated
- [ ] `docs/data-dictionary.md` updated
- [ ] Indexes reviewed
- [ ] Integration test added

**API**
- [ ] Request/response schema updated
- [ ] Zod validation updated
- [ ] Existing clients still work

**Status machine**
- [ ] Transition map updated
- [ ] Invalid-transition tests updated
- [ ] Admin UI offers exactly the legal transitions

**Price or inventory**
- [ ] Domain tests added
- [ ] Order-snapshot behaviour unchanged
- [ ] Audit logging verified

**Design system**
- [ ] No literal colours outside `tokens.css`
- [ ] Checked at 390 / 768 / 1440
- [ ] Contrast checked, fill-vs-text tokens correct
- [ ] Italian labels checked at 390px

## Invariants

- [ ] No client-supplied price, total, stock, role or status is trusted
- [ ] No automatic path to `verified` payment
- [ ] No fabricated commerce claim introduced
- [ ] No secret committed
