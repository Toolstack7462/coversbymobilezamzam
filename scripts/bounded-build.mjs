/**
 * Runs a build with a BOUNDED bundler thread pool.
 *
 *   node scripts/bounded-build.mjs react-router build --config vite.node.config.ts
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Vite 8 bundles with Rolldown, which is Rust and starts a rayon thread pool
 * sized to the machine's CPU count. On the merchant's shared host that count is
 * **64**, while CloudLinux caps how many threads one account may have. Rayon
 * asks for 64, the kernel answers `EAGAIN`, and rolldown panics before any
 * bundling happens:
 *
 *     thread 'rolldown-worker' panicked at rayon-core/src/registry.rs:171
 *     The global thread pool has not been initialized.:
 *     ThreadPoolBuildError { kind: IOError(Os { code: 11, kind: WouldBlock,
 *     message: "Resource temporarily unavailable" }) }
 *     failed to load config from vite.node.config.ts
 *
 * Nothing in that message mentions threads, limits or the host. It reads like a
 * bug in the bundler, and the advice it prints is to file one.
 *
 * ── WHY IT LOOKED INTERMITTENT ──────────────────────────────────────────────
 *
 * It depends on how many processes the account is already using, so the same
 * commit builds or does not depending on what else is running. Hostinger's very
 * first deployment DID get through this step — which is why the visible error
 * in that log is a later one — and every attempt afterwards panicked. A build
 * that fails only when the account is busy is worse than one that always
 * fails, because it teaches everyone to retry rather than to look.
 *
 * ── WHY FOUR ─────────────────────────────────────────────────────────────────
 *
 * Enough to keep a build fast, low enough to sit under any per-account limit
 * worth having. Measured on the host: 64 threads panics, 4 builds the whole
 * application in about a second. An explicit RAYON_NUM_THREADS in the
 * environment always wins, so CI or a developer can raise it.
 *
 * ── WHY A SCRIPT AND NOT `RAYON_NUM_THREADS=4 npm run build` ────────────────
 *
 * That syntax is a shell feature. It is a syntax error in `cmd.exe`, and this
 * project is developed on Windows and deployed on Linux — a build command that
 * only works on one of them is how the two environments quietly diverge.
 */

import { execFileSync } from "node:child_process";
import os from "node:os";

const DEFAULT_THREADS = 4;

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/bounded-build.mjs <command> [args...]");
  process.exit(1);
}

/*
 * Only if nobody has said otherwise. A machine with room, or a CI runner that
 * wants the cores, sets this and is obeyed.
 */
const threads =
  process.env.RAYON_NUM_THREADS ?? String(Math.min(DEFAULT_THREADS, os.cpus().length));

try {
  execFileSync(command, args, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, RAYON_NUM_THREADS: threads },
  });
} catch (error) {
  // The child has already printed whatever it printed; adding a stack trace of
  // this wrapper on top only buries it.
  process.exit(typeof error?.status === "number" ? error.status : 1);
}
