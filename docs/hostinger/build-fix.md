# The Hostinger build failure

Why the Git deployment failed, what actually caused it, and what stops it
happening again.

Investigated 2026-09-14 against the real deployment log and reproduced in
Hostinger's own environment — same machine, same Node, same commands.

---

## 1. The error in the log

One error, on the last line of 174:

```
ERROR: No output directory found after build
```

**That is not the cause.** It is the last of three, and the only one the log
shows. Reading it alone leads to changing an output-directory setting, which
fixes nothing.

### What the log actually establishes

| Phase                   | Result                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| Dependency installation | **Succeeded** — `added 279 packages, and audited 280 packages in 20s` |
| Compilation             | **Succeeded** — `✓ built in 2.07s`, client and SSR bundles emitted    |
| Publish                 | **Failed** — `No output directory found after build`                  |
| Server startup          | **Never attempted**                                                   |

Install emitted `EBADENGINE` warnings and carried on, which is npm's behaviour
for an engine mismatch — a warning, not a failure. They matter later.

---

## 2. Three causes, in the order they bite

### Cause 1 — the connected branch is the pre-migration application

Hostinger deploys `main`. At the time of the failure `main` was
`36d2c796dc7e07a572157ddc44f3fe8160c4a86b`, dated 2026-08-31, and the Hostinger
migration was **63 commits ahead of it** on `feat/hostinger-migration`.

`main` at that commit is the **Cloudflare Workers + D1** application. It has no
Node server entry, no `build:hostinger`, no MariaDB adapter, and no Express.
`npm run build` there produces a **Worker bundle** — code for `workerd`, which
Node cannot execute.

So the publish step was looking for a directory of files to serve, and the
build had produced a Worker. Hence the message, and hence the parked page.

**Even a green build on that commit deploys nothing runnable.** This is the
cause that matters most and the only one that cannot be fixed by a setting.

### Cause 2 — Rolldown cannot start its thread pool on shared hosting

Reproduced on the server, on a clean clone, on **Node 20, 22 and 24 alike**:

```
thread 'rolldown-worker' panicked at rayon-core-1.13.0/src/registry.rs:171:10:
The global thread pool has not been initialized.:
ThreadPoolBuildError { kind: IOError(Os { code: 11, kind: WouldBlock,
                       message: "Resource temporarily unavailable" }) }
failed to load config from vite.node.config.ts
[Error: Panic in async function] { code: 'GenericFailure' }
```

Vite 8 bundles with Rolldown, which is Rust and sizes its rayon thread pool to
the CPU count. `nproc` on this host reports **64**. CloudLinux caps how many
threads one account may hold, the kernel answers `EAGAIN`, and rolldown panics
before any bundling happens.

Nothing in that message mentions threads, limits or the host. It reads as a bug
in the bundler and tells you to report one.

**It is load-dependent, which is why it looked intermittent.** Hostinger's very
first deployment got _through_ this step — which is why the error visible in
that log is the later one — and every attempt afterwards panicked. A build that
fails only when the account is busy teaches everybody to retry instead of look.

### Cause 3 — the Node version is below what React Router requires

```
npm warn EBADENGINE package: '@react-router/dev@8.3.1'
npm warn EBADENGINE required: { node: '>=22.22.0' }
npm warn EBADENGINE current:  { node: 'v20.19.4' }
```

and at build time, fatally:

```
⚠️ Oops, Node v20.19.4 detected. react-router requires a Node version greater than 22.22.0.
```

hPanel is set to **Node 20.x**. `react-router@8.3.1` and `@react-router/dev`
require **> 22.22.0**. Node 22.18.0 is _also_ below it — the only interpreter on
this host that satisfies it is **alt-nodejs24** (v24.6.0).

---

## 3. The fix

### In the repository

`scripts/bounded-build.mjs` caps the bundler's thread pool and every build
script goes through it:

```json
"build":        "node scripts/bounded-build.mjs react-router build",
"build:node":   "node scripts/bounded-build.mjs react-router build --config vite.node.config.ts",
"build:server": "node scripts/bounded-build.mjs vite build --config vite.server.config.ts"
```

Four threads: measured on the host, 64 panics and 4 builds the whole
application in about a second. An explicit `RAYON_NUM_THREADS` still wins, so
CI can have the cores.

A wrapper script rather than `RAYON_NUM_THREADS=4 npm run build`, because that
is shell syntax and a syntax error in `cmd.exe` — this project is developed on
Windows and deployed on Linux, and a build command that works on only one of
them is how the two quietly diverge.

### Measured, before and after, on the server

|                              | Node 20      | Node 22      | Node 24      |
| ---------------------------- | ------------ | ------------ | ------------ |
| `build:hostinger`, unbounded | panic        | panic        | panic        |
| `build:hostinger`, bounded   | engine error | engine error | **succeeds** |
| `npm run build`, unbounded   | —            | —            | panic        |
| `npm run build`, bounded     | —            | —            | **succeeds** |

Both fixes are required, and neither is sufficient alone.

### Branch

`main` fast-forwards to the migration branch — `main` is an ancestor, so this
is not a rewrite and not a force-push. No history is discarded and every newer
frontend and admin commit is preserved.

---

## 4. What is NOT fixed by any of this

**Hostinger's Git deployment publishes a directory of files. This application
is a process.**

Even with a green build on the right branch and the right Node version, that
pipeline has nowhere to put an SSR application: there is no static output to
serve, and nothing in it starts `build/server-node/index.js`.

What actually serves the site today is a different mechanism, already in place
and working:

```
public_html/.htaccess  →  Passenger directives  →  <domain>/current/build/server-node/index.js
```

built and shipped by `npm run hostinger:deploy` — build here, upload one
archive, install from the lockfile on the server, check the release loads, then
move a symlink.

So there are two possible end states, and it is a decision rather than a fix:

|                                                                           |                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep the SSH release flow** and turn Hostinger's Git deployment **off** | What runs now, proven end to end. The Git deployment stops failing because it stops running.                                                                                                                                                                                       |
| **Make the Git deployment do it**                                         | Needs its build command set to `npm run build:hostinger`, Node set to 24, and — the unknown — a way to have it leave `public_html/.htaccess` alone while publishing the release elsewhere. Whether its settings allow that cannot be read from the server; it is an hPanel screen. |

---

## 5. Prevention

|                                                                       |                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The build is now deterministic on constrained hosts.**              | The thread cap is in the repository, not in anyone's shell, so it applies to every environment that runs these scripts.                                                                                                                |
| **`engines` should say what is true.**                                | `package.json` asks for `node >=20.0.0` while the toolchain needs `>22.22.0`. npm only warns, so the mismatch reaches the build instead of the install. Raising it makes `npm ci` refuse early, with a message that names the version. |
| **A deployment that cannot start the app should not report success.** | The SSH flow checks the release can be `import`ed before moving the symlink; a static pipeline has no equivalent, which is why "deployed" and "serving" are different questions here.                                                  |
| **Read the whole log, from the top.**                                 | The only error in this one is on line 174 and is a consequence. The two real causes are a warning on line 20 and a panic that does not appear at all in the run that was examined.                                                     |

---

## 6. Verification performed

- Failure reproduced on a clean clone, in Hostinger's own environment, on the
  same Node as hPanel is configured for.
- Fix verified the same way: clean clone, `npm ci`, `npm run build:hostinger`,
  real build output present.
- The live site was checked throughout and never went down.
