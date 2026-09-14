/**
 * The password rules, in one place, for the server and the form alike.
 *
 * Better Auth enforces the length; it is configured from these constants in
 * `auth.server.ts`. The admin forms state the same rule to the person typing,
 * BEFORE they submit — which is the part that was missing. A merchant choosing
 * a password in the first-run setup, or accepting an invitation, learned the
 * twelve-character minimum by having their chosen password rejected.
 *
 * Two copies of a number are one number that will eventually disagree with
 * itself, and the direction of the disagreement is the bad one: a form that
 * promises "at least 8" while the server demands 12 produces a rejection the
 * person cannot act on.
 *
 * This file is imported by client components, so it must stay free of server
 * imports and hold nothing but the policy itself.
 */

/** 12 rather than 8. These accounts can change where money goes. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * An upper bound exists because hashing is deliberately slow: an unbounded
 * password is a request that costs the server real CPU to reject.
 */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Shown beneath a field where a password is being CHOSEN.
 *
 * Not shown on a field that confirms an existing password: the rule is not
 * something the person can act on there, and a requirement list beside "your
 * current password" reads as though the current password is being re-validated.
 */
export const PASSWORD_REQUIREMENTS = [
  `Almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
  "Sono ammessi spazi e caratteri speciali: la password non viene modificata in alcun modo.",
] as const;
