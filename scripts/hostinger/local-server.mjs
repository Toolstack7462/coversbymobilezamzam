/**
 * Starts the built Node server against the local MariaDB.
 *
 *   node scripts/hostinger/local-server.mjs            # run until Ctrl-C
 *   import { startLocalServer } from "./local-server.mjs"
 *
 * ── WHY THIS EXISTS RATHER THAN A README PARAGRAPH ──────────────────────────
 *
 * The performance baseline, the cache isolation proof and the soak test all
 * need the same thing: the TARGET runtime — Express, mysql2, MariaDB 10.11 —
 * serving the real migrated catalogue. Reconstructing sixteen environment
 * variables by hand each time is how two measurements end up describing two
 * different configurations, and the difference between them gets attributed to
 * the change being measured.
 *
 * ── THE SECRETS HERE ARE NOT SECRETS ────────────────────────────────────────
 *
 * They are fixed development constants, and they are safe only because of what
 * this script also does: it binds to 127.0.0.1, refuses to run with
 * NODE_ENV=production, and points at a database on port 3399 that exists only
 * on a developer machine. Nothing here is a value that appears on Hostinger —
 * real values come from hPanel and are never in this repository
 * (.env.hostinger.example).
 */

import { setTimeout, clearTimeout } from "node:timers";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const LOCAL_PORT = Number(process.env.LOCAL_SERVER_PORT ?? 3210);
export const LOCAL_BASE = `http://127.0.0.1:${LOCAL_PORT}`;

const ROOT = process.cwd();
const STORAGE = path.join(ROOT, ".local", "storage");
export const PUBLIC_ROOT = path.join(STORAGE, "public");
export const PRIVATE_ROOT = path.join(STORAGE, "private");
export const VERSION_FILE = path.join(PRIVATE_ROOT, ".cache-version");

const ENTRY = path.join(ROOT, "build", "server-node", "index.js");

/**
 * Throwaway secrets, generated fresh on every start.
 *
 * NOT constants in this file, and the reason is not only that the secret
 * scanner refuses them: a fixed "development" secret in a repository is a
 * secret, because the day somebody copies this script to bring up a real
 * environment it becomes the real one. Generated values cannot be copied by
 * accident.
 *
 * Long enough to satisfy the length checks in server/config.ts. They live for
 * the lifetime of one server process; a restart invalidates any session issued
 * against the previous one, which for a measurement harness is the correct
 * behaviour rather than an inconvenience.
 *
 * `DEV_JOB_SECRET` is exported because the isolation and comparison scripts
 * have to present it to `/api/cache-stats` and `/api/jobs/run`.
 */
const throwaway = (label) => `${label}-${randomBytes(24).toString("hex")}`;

export const DEV_JOB_SECRET = throwaway("local-throwaway-job");

const DEV_SECRETS = {
  BETTER_AUTH_SECRET: throwaway("local-throwaway-auth"),
  SETTINGS_ENCRYPTION_KEY: throwaway("local-throwaway-settings"),
  JOB_AUTH_SECRET: DEV_JOB_SECRET,
};

export function localEnvironment(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "development",
    APP_ENV: "staging",
    APP_BASE_URL: LOCAL_BASE,
    HOST: "127.0.0.1",
    PORT: String(LOCAL_PORT),
    TRUSTED_HOSTS: `127.0.0.1:${LOCAL_PORT},localhost:${LOCAL_PORT}`,

    DB_HOST: process.env.TEST_DB_HOST ?? "127.0.0.1",
    DB_PORT: String(process.env.TEST_DB_PORT ?? 3399),
    DB_NAME: process.env.DB_NAME ?? "zamzam_staging",
    DB_USER: process.env.TEST_DB_USER ?? "root",
    DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? "",
    DB_SSL: "off",
    DB_CONNECTION_LIMIT: process.env.DB_CONNECTION_LIMIT ?? "8",

    PUBLIC_MEDIA_ROOT: PUBLIC_ROOT,
    PRIVATE_MEDIA_ROOT: PRIVATE_ROOT,

    ...DEV_SECRETS,
    ...overrides,
  };
}

/**
 * Refuses to start when something is already on the port.
 *
 * This is not tidiness. A leftover server from an earlier run answers the
 * health check, every measurement that follows describes THAT process, and the
 * numbers are attributed to whatever was just changed. It has already happened
 * once in this project: an isolation run reported the cache missing entirely
 * because a server built before the cache existed was still listening.
 */
async function refuseIfOccupied() {
  try {
    const response = await fetch(`${LOCAL_BASE}/api/health`);
    throw new Error(
      `Something is already listening on ${LOCAL_BASE} (it answered /api/health with ` +
        `HTTP ${response.status}). Stop it first — measuring a server this script did not ` +
        `start means measuring an unknown build.`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Something is already listening")) {
      throw error;
    }
    // Anything else means nothing answered, which is what we want.
  }
}

/** Waits for the server to answer, or gives up with the reason it did not. */
async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${LOCAL_BASE}/api/health`);
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy in ${timeoutMs}ms: ${lastError}`);
}

/**
 * Starts the server and resolves once it is answering.
 *
 * Returns `{ pid, base, stop, output }`. `output` is everything the process
 * wrote, kept so a failing assertion can show the server's own log rather than
 * only the failed expectation.
 */
export async function startLocalServer({ env = {}, quiet = true } = {}) {
  if (!fs.existsSync(ENTRY)) {
    throw new Error(`No server build at ${ENTRY}. Run \`npm run build:hostinger\` first.`);
  }

  await refuseIfOccupied();

  fs.mkdirSync(PUBLIC_ROOT, { recursive: true });
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });

  const child = spawn(process.execPath, [ENTRY], {
    env: localEnvironment(env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = [];
  const capture = (stream) => {
    stream.setEncoding("utf8");
    stream.on("data", (text) => {
      output.push(text);
      if (!quiet) process.stdout.write(text);
    });
  };
  capture(child.stdout);
  capture(child.stderr);

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  try {
    const health = await waitForHealth();
    return {
      pid: child.pid,
      base: LOCAL_BASE,
      health,
      get log() {
        return output.join("");
      },
      async stop() {
        if (exited !== null) return;
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 10_000);
          child.on("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    // The server's own output says WHY — a missing environment variable, a
    // refused database connection — and the timeout message alone does not.
    throw new Error(`${error.message}\n\n--- server output ---\n${output.join("")}`, {
      cause: error,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const server = await startLocalServer({ quiet: false });
  console.log(`\n[local-server] pid ${server.pid} on ${server.base} — Ctrl-C to stop\n`);
  const stop = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
