/**
 * Build-time constants, replaced by Vite's `define`.
 *
 * These are not variables: after the build there is no lookup, only the literal
 * value that was true when the bundle was made. That is the point — a Worker
 * has no git and no filesystem, so the only way it can report which commit it
 * is running is for the answer to be compiled into it.
 */

/** Full 40-character commit SHA, or "unknown" outside a git checkout. */
declare const __GIT_SHA__: string;

/** True when the working tree had uncommitted changes at build time. */
declare const __GIT_DIRTY__: boolean;

/** ISO-8601 timestamp of the build. */
declare const __BUILD_TIME__: string;
