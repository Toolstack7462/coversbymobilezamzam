/**
 * Deploys the Node application to Hostinger.
 *
 *   npm run hostinger:deploy              # build, upload, switch, restart, verify
 *   npm run hostinger:deploy -- --dry-run # say what it would do
 *   npm run hostinger:deploy -- --rollback
 *
 * ── WHY NOT HOSTINGER'S GIT DEPLOYMENT ──────────────────────────────────────
 *
 * It was tried, by the merchant, before this script existed. The build log
 * ends:
 *
 *     ERROR: No output directory found after build
 *
 * That flow is for STATIC sites: it runs a build and then looks for a directory
 * of files to publish into `public_html`. `npm run build` is the Cloudflare
 * build, which produces a Worker bundle, and an SSR application has no
 * directory of files to publish at all — the thing that serves the site is a
 * process. So the domain kept serving Hostinger's parked page and nothing said
 * why.
 *
 * ── HOW A RELEASE IS SWITCHED ───────────────────────────────────────────────
 *
 * Atomically, by moving a symlink:
 *
 *     domains/<domain>/releases/2026-09-14T08-40-00Z/   the new one, complete
 *     domains/<domain>/current -> releases/2026-09-14T08-40-00Z
 *
 * Nothing is ever edited in place under a running application. A release is
 * uploaded, its dependencies are installed, it is checked, and only then does
 * `current` move — so a half-uploaded release cannot be served, and rolling
 * back is moving the symlink to the previous directory rather than a rebuild.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It never runs migrations. `npm run hostinger:migrate` is a separate,
 * deliberate step: an automatic migration on every push is a schema change
 * nobody reviewed, and two workers starting at once would run it twice.
 *
 * It never touches `public_html` at all. The `.htaccess` there points at
 * `<domain>/current`, which is a stable path, so it does not change between
 * releases — and it holds the configuration, which is `npm run
 * hostinger:configure`'s business and is written deliberately rather than on
 * every push. This script does read the docroot, and refuses to run if it holds
 * a site it did not put there.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { withSsh, mustRun } from "./lib/ssh.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const DOMAIN = flag("domain", process.env.HOSTINGER_DOMAIN ?? "coversbymobile.com");
const NODE_BIN = flag("node-bin", "/opt/alt/alt-nodejs20/root/usr/bin/node");
const NPM_BIN = flag("npm-bin", "/opt/alt/alt-nodejs20/root/bin/npm");
const KEEP = Number(flag("keep", "3"));
const DRY = has("dry-run");

const REMOTE_HOME = `/home/${process.env.HOSTINGER_SSH_USER ?? ""}`;
const DOMAIN_ROOT = `${REMOTE_HOME}/domains/${DOMAIN}`;
const RELEASES = `${DOMAIN_ROOT}/releases`;
const CURRENT = `${DOMAIN_ROOT}/current`;
const DOCROOT = `${DOMAIN_ROOT}/public_html`;

/**
 * What is uploaded.
 *
 * The BUILD, not the source. `node_modules` is not in the list: it is installed
 * on the server from the lockfile, because a tree built on Windows contains
 * platform-specific binaries that do not run on Linux — and mysql2 and
 * better-auth both resolve files at runtime.
 *
 * `db/mariadb/migrations` travels with the release so the migration step has
 * the exact SQL that matches this build, rather than whatever is on the server.
 */
const PAYLOAD = [
  "build",
  "package.json",
  "package-lock.json",
  "db/mariadb/migrations",
  /*
   * The maintenance scripts travel with the release.
   *
   * `migrate.mjs` and `import-mariadb.mjs` need a database connection, and on
   * shared hosting the database listens on localhost only — so they cannot be
   * run from a developer machine at all. They have to run on the server, which
   * means they have to be there, and they have to be the versions that match
   * this build rather than whatever a previous deploy left behind.
   *
   * They need nothing but `mysql2`, which `npm ci` installs as a production
   * dependency.
   */
  "scripts/hostinger",
];

function say(step, detail = "") {
  console.log(`  ${step.padEnd(34)} ${detail}`);
}

/** The release name is the deploy time, so `ls` sorts into deploy order. */
const RELEASE = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/-\d{3}Z$/, "Z");

async function rollback(ssh) {
  const { out } = await ssh.run(`ls -1 ${RELEASES} 2>/dev/null | sort`);
  const releases = out.trim().split("\n").filter(Boolean);
  if (releases.length < 2) {
    throw new Error(`Nothing to roll back to: ${releases.length} release(s) on the server.`);
  }

  const { out: currentOut } = await ssh.run(`readlink ${CURRENT} || true`);
  const currentName = path.posix.basename(currentOut.trim());
  const index = releases.indexOf(currentName);
  const previous = index > 0 ? releases[index - 1] : releases[releases.length - 2];

  say("rolling back to", previous);
  if (DRY) return previous;

  await mustRun(
    ssh,
    `ln -sfn ${RELEASES}/${previous} ${CURRENT}.tmp && mv -Tf ${CURRENT}.tmp ${CURRENT}`,
    "symlink switch",
  );
  await mustRun(ssh, `mkdir -p ${CURRENT}/tmp && touch ${CURRENT}/tmp/restart.txt`, "restart");
  return previous;
}

async function main() {
  console.log(`Deploying to ${DOMAIN}${DRY ? "  (dry run)" : ""}\n`);

  if (has("rollback")) {
    await withSsh(async (ssh) => {
      const to = await rollback(ssh);
      console.log(`\n  Rolled back to ${to}.`);
    });
    return;
  }

  // ── 1. Build, here ────────────────────────────────────────────────────────
  //
  // On this machine, not on the server: the server is a shared host under a
  // load average that is not ours to add to, and a build that only happens
  // where it is deployed is a build nobody can reproduce.
  if (!has("skip-build")) {
    say("building", "npm run build:hostinger");
    if (!DRY) execFileSync("npm", ["run", "build:hostinger"], { stdio: "pipe", shell: true });
  }

  for (const entry of PAYLOAD) {
    if (!fs.existsSync(entry)) {
      throw new Error(`Missing ${entry}. Run \`npm run build:hostinger\` first.`);
    }
  }

  /*
   * One archive, not several hundred files.
   *
   * `build/client/assets` alone is dozens of files, and SFTP pays a round trip
   * per file. A single compressed upload is the difference between a deploy
   * that takes seconds and one that takes minutes over a domestic connection.
   */
  /*
   * A RELATIVE path, in the repository's own scratch directory.
   *
   * Not the system temp directory: on Windows that is an absolute path
   * beginning "C:", and GNU tar reads everything before a colon as a REMOTE
   * HOSTNAME. It fails with "Cannot connect to C: resolve failed", which says
   * nothing about paths at all. `--force-local` fixes it for GNU tar and is
   * rejected by the bsdtar that ships with Windows, so the portable answer is
   * to never hand tar a path with a colon in it.
   */
  fs.mkdirSync(".local", { recursive: true });
  const tarball = path.posix.join(".local", `zamzam-${RELEASE}.tar.gz`);
  say("packing", path.basename(tarball));
  if (!DRY) execFileSync("tar", ["-czf", tarball, ...PAYLOAD], { stdio: "pipe" });
  const size = DRY ? 0 : fs.statSync(tarball).size;
  say("", `${(size / 1024 / 1024).toFixed(1)} MB`);

  await withSsh(async (ssh) => {
    // ── 2. Refuse to trample somebody else's site ──────────────────────────
    //
    // The guard exists to catch ANOTHER WEBSITE in this docroot. It must not
    // trip over the deployment system's own footprint, which is what it did:
    //
    //   .htaccess.bak   written by `hostinger:configure`, which keeps the
    //                   previous configuration so a bad change is undoable
    //   tmp/            holds Passenger's `restart.txt` trigger
    //
    // Both appear the first time the site is configured and restarted, so
    // every deploy AFTER the first one failed with "contains files this deploy
    // did not put there" — naming two files this deployment system had put
    // there itself. The release then could not proceed at all.
    //
    // Listed by exact name rather than by pattern: a real second website is
    // still refused, which is the entire point.
    const OURS = ["default.php", ".htaccess", ".htaccess.bak", ".well-known", "tmp"];
    const { out: docrootListing } = await ssh.run(`ls -A ${DOCROOT} 2>/dev/null`);
    const unexpected = docrootListing
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((name) => !OURS.includes(name));

    if (unexpected.length > 0) {
      throw new Error(
        `${DOCROOT} contains files this deploy did not put there:\n` +
          `  ${unexpected.join(", ")}\n\n` +
          `Refusing to continue. The brief says the merchant's other website must not be\n` +
          `modified, and a docroot with a site in it is how that happens by accident.`,
      );
    }

    if (DRY) {
      say("would upload to", `${RELEASES}/${RELEASE}`);
      say("would point", `${CURRENT} -> releases/${RELEASE}`);
      return;
    }

    // ── 3. Upload and unpack into a NEW release directory ──────────────────
    await mustRun(ssh, `mkdir -p ${RELEASES}/${RELEASE}`, "mkdir release");
    say("uploading", `${RELEASES}/${RELEASE}`);
    await ssh.put(tarball, `${RELEASES}/${RELEASE}/release.tar.gz`);
    await mustRun(
      ssh,
      `cd ${RELEASES}/${RELEASE} && tar -xzf release.tar.gz && rm -f release.tar.gz`,
      "unpack",
    );

    // ── 4. Dependencies, from the lockfile, on the server ──────────────────
    /*
     * ── TWO THINGS THAT ARE NOT OBVIOUS ────────────────────────────────────
     *
     * PATH. The npm launcher is a shell script, and a package's install script
     * runs `node` by NAME. There is no `node` on the default PATH of this
     * account — the runtimes live under /opt/alt — so any package with a
     * postinstall fails with `sh: node: command not found`, which says nothing
     * about PATH and sounds like Node is missing entirely.
     *
     * --ignore-scripts. Every production dependency here is plain JavaScript:
     * mysql2, express, react, react-router, better-auth, drizzle-orm,
     * nodemailer, compression, isbot, uqr, zod. Not one needs a postinstall to
     * work, so running them buys nothing — and it means a compromised
     * transitive package cannot execute code on the merchant's host at deploy
     * time. The failure above was esbuild's postinstall, belonging to a package
     * nothing in this application calls:
     *
     *     better-auth declares drizzle-kit as an OPTIONAL PEER dependency, so
     *     npm resolves it into the production tree even though package.json
     *     lists drizzle-kit under devDependencies. `--omit=dev` does not drop
     *     it, because as far as npm is concerned it is not a dev dependency.
     *
     * It is still installed, and that is accepted rather than fought: dropping
     * it needs `--omit=peer`, which also drops peers that packages genuinely
     * need at runtime. Disk is cheap; a missing runtime peer is a 500.
     */
    say("installing", "npm ci --omit=dev --ignore-scripts");

    /*
     * NOT piped into `tail`.
     *
     * `npm ci … | tail -5` reports TAIL's exit status, not npm's — so a failed
     * install looks like a successful one and the deploy carries on to switch
     * the symlink. It cost a confusing failure here: npm could not fork under a
     * saturated process limit, installed nothing, "succeeded", and the only
     * thing that noticed was the module check two steps later.
     *
     * The whole output is captured and only the tail is PRINTED, which is what
     * the pipe was for in the first place.
     */
    const install = await ssh.run(
      `cd ${RELEASES}/${RELEASE} && PATH="${path.posix.dirname(NODE_BIN)}:$PATH" ` +
        `${NPM_BIN} ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1`,
    );

    if (install.code !== 0) {
      throw new Error(
        `npm ci exited ${install.code}:\n${install.out.trim().split("\n").slice(-15).join("\n")}`,
      );
    }

    /*
     * And an exit code of 0 is still not proof.
     *
     * npm can report success having installed nothing at all. The release is
     * about to be served, so the question worth asking is whether the
     * dependencies are THERE — checked against the one package whose absence
     * would take the whole site down.
     */
    const installed = await ssh.run(
      `test -d ${RELEASES}/${RELEASE}/node_modules/mysql2 && echo present || echo missing`,
    );
    if (!installed.out.includes("present")) {
      throw new Error(
        `npm ci reported success but node_modules/mysql2 is not there.\n` +
          install.out.trim().split("\n").slice(-15).join("\n"),
      );
    }

    say("", install.out.trim().split("\n").filter(Boolean).pop() ?? "");

    // ── 5. Prove the release can start BEFORE it serves anything ───────────
    //
    // A syntax error or a missing module would otherwise be discovered by the
    // first customer. This only checks that the entry point parses and its
    // imports resolve — it cannot check configuration, which needs the real
    // environment.
    const smoke = await ssh.run(
      `cd ${RELEASES}/${RELEASE} && ${NODE_BIN} --input-type=module -e ` +
        `"import('./build/server-node/tools.js').then(()=>console.log('imports ok'))` +
        `.catch(e=>{console.error(e.message);process.exit(1)})"`,
    );
    if (smoke.code !== 0) {
      throw new Error(`The uploaded release cannot be loaded:\n${smoke.out}`);
    }
    say("module check", smoke.out.trim());

    // ── 6. Switch, atomically ──────────────────────────────────────────────
    await mustRun(ssh, `mkdir -p ${RELEASES}/${RELEASE}/tmp`, "mkdir tmp");
    await mustRun(
      ssh,
      `ln -sfn ${RELEASES}/${RELEASE} ${CURRENT}.tmp && mv -Tf ${CURRENT}.tmp ${CURRENT}`,
      "symlink switch",
    );
    say("switched", `current -> ${RELEASE}`);

    // ── 7. Restart and prune ───────────────────────────────────────────────
    await mustRun(ssh, `touch ${CURRENT}/tmp/restart.txt`, "restart");
    say("restarted", "tmp/restart.txt touched");

    const { out: all } = await ssh.run(`ls -1 ${RELEASES} | sort`);
    const releases = all.trim().split("\n").filter(Boolean);
    const stale = releases.slice(0, Math.max(0, releases.length - KEEP));
    for (const old of stale) {
      await ssh.run(`rm -rf ${RELEASES}/${old}`);
    }
    if (stale.length > 0) say("pruned", `${stale.length} old release(s), keeping ${KEEP}`);
  });

  if (!DRY) fs.rmSync(tarball, { force: true });

  console.log(
    `\n  Deployed ${RELEASE}.\n` +
      `  Migrations are NOT run by this script — that is \`npm run hostinger:migrate\`.\n` +
      `  Roll back with \`npm run hostinger:deploy -- --rollback\`.`,
  );
}

await main();
