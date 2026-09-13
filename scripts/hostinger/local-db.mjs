/**
 * Starts, stops and reports on a local MariaDB for the integration tests.
 *
 *   node scripts/hostinger/local-db.mjs start|stop|status|version
 *
 * WHY A DOWNLOADED SERVER RATHER THAN DOCKER. Docker is the obvious answer and
 * it is not available on every machine this project is worked on — it is not
 * installed on the one this migration was built on. The alternative to a real
 * server is testing MariaDB behaviour against SQLite, which is not testing it.
 *
 * The server is a plain extracted archive under a working directory OUTSIDE
 * the repository: it is 400 MB of binaries and a data directory, neither
 * belongs in Git, and the data directory will hold a copy of the catalogue
 * during a migration rehearsal. Nothing here is committed.
 *
 * CI can ignore this entirely and point TEST_DB_* at a service container; the
 * tests read the same variables either way.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";

const VERSION = process.env.MARIADB_VERSION ?? "10.11.19";
const PORT = Number(process.env.TEST_DB_PORT ?? 3399);

const WORK = process.env.HOSTINGER_WORK_DIR ?? path.join(os.homedir(), "hostinger-migration-work");
const ROOT = path.join(WORK, "mariadb");
const HOME = path.join(ROOT, `mariadb-${VERSION}-winx64`);
const DATA = path.join(ROOT, "data");
const LOG = path.join(ROOT, "server.log");
const PIDFILE = path.join(ROOT, "server.pid");

const bin = (name) => path.join(HOME, "bin", process.platform === "win32" ? `${name}.exe` : name);

function ensureInstalled() {
  if (!fs.existsSync(bin("mariadbd"))) {
    console.error(
      `MariaDB ${VERSION} is not present at ${HOME}.\n\n` +
        `Install it with:\n` +
        `  curl -o "${ROOT}/mariadb.zip" https://archive.mariadb.org/mariadb-${VERSION}/winx64-packages/mariadb-${VERSION}-winx64.zip\n` +
        `  # verify against https://archive.mariadb.org/mariadb-${VERSION}/winx64-packages/sha256sums.txt\n` +
        `  unzip -d "${ROOT}" "${ROOT}/mariadb.zip"\n\n` +
        `Or set TEST_DB_HOST/TEST_DB_PORT to any MariaDB ${VERSION.split(".").slice(0, 2).join(".")} server.`,
    );
    process.exit(1);
  }
}

function isRunning() {
  try {
    execFileSync(
      bin("mariadb-admin"),
      ["-h", "127.0.0.1", "-P", String(PORT), "-u", "root", "ping"],
      {
        stdio: "ignore",
        timeout: 5000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const command = process.argv[2] ?? "status";

switch (command) {
  case "start": {
    ensureInstalled();
    if (isRunning()) {
      console.log(`MariaDB already listening on 127.0.0.1:${PORT}.`);
      break;
    }
    if (!fs.existsSync(path.join(DATA, "mysql"))) {
      console.error(`No data directory at ${DATA}. Initialise it with mariadb-install-db first.`);
      process.exit(1);
    }

    const child = spawn(
      bin("mariadbd"),
      [`--defaults-file=${path.join(DATA, "my.ini")}`, "--console"],
      {
        detached: true,
        stdio: ["ignore", fs.openSync(LOG, "a"), fs.openSync(LOG, "a")],
      },
    );
    child.unref();
    fs.writeFileSync(PIDFILE, String(child.pid), "utf8");

    // Poll rather than sleep a fixed amount: on a cold start InnoDB recovery
    // can take a few seconds, and on a warm one it is instant.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (isRunning()) {
        console.log(`MariaDB ${VERSION} listening on 127.0.0.1:${PORT} (pid ${child.pid}).`);
        process.exit(0);
      }
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{},400)"], { timeout: 2000 });
    }
    console.error(`MariaDB did not become ready within 30s. See ${LOG}.`);
    process.exit(1);
    break;
  }

  case "stop": {
    ensureInstalled();
    if (!isRunning()) {
      console.log("MariaDB is not running.");
      break;
    }
    execFileSync(
      bin("mariadb-admin"),
      ["-h", "127.0.0.1", "-P", String(PORT), "-u", "root", "shutdown"],
      {
        stdio: "inherit",
      },
    );
    console.log("MariaDB stopped.");
    break;
  }

  case "version": {
    ensureInstalled();
    const out = execFileSync(
      bin("mariadb"),
      [
        "-h",
        "127.0.0.1",
        "-P",
        String(PORT),
        "-u",
        "root",
        "--batch",
        "--skip-column-names",
        "-e",
        "SELECT VERSION(), @@version_comment, @@sql_mode, @@default_storage_engine, @@character_set_server, @@collation_server",
      ],
      { encoding: "utf8" },
    );
    console.log(out.trim());
    break;
  }

  default: {
    console.log(isRunning() ? `running on 127.0.0.1:${PORT}` : "not running");
  }
}
