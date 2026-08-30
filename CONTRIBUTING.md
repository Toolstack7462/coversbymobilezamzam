# Contributing

## Before you change anything

Read `CLAUDE.md`. It is the operating contract, and most review comments are it
being restated.

## The loop

    npm run verify

If it does not pass, the change is not finished. Report failures honestly rather
than working around them.

## Where code goes

| Adding                              | Goes in                                   |
| ----------------------------------- | ----------------------------------------- |
| A calculation over plain data       | `app/domain/<area>/`                      |
| Orchestration that touches storage  | `app/application/commands/` or `queries/` |
| An interface onto the outside world | `app/application/ports/`                  |
| A D1 / R2 / email implementation    | `app/infrastructure/`                     |
| A route                             | `app/routes/`                             |
| Markup                              | `app/components/`                         |

**If a domain test needs a Cloudflare binding, the code is in the wrong layer.**

## Rules that get changes rejected

- A literal colour outside `app/styles/tokens.css`
- A user-visible string hardcoded in a component
- A price, total, stock figure, role or status accepted from the client
- A business rule implemented twice
- A schema change without a migration, types and a test
- Any path that marks payment verified without a human
- A fabricated commerce claim (see `CLAUDE.md` §7)
- An interactive target under 44x44px

## Commits

Explain **why**, not what — the diff already says what. Group a coherent change
into one commit. Never commit secrets. Never push failing code.

## Reviewing

The read-only agents in `.claude/agents/` cover architecture, database, security,
accessibility, performance, UI consistency, tests and release. They report; a
human applies fixes. Two agents never edit the same file, because they never edit
anything.
