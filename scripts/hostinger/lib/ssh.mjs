/**
 * The SSH connection the Hostinger scripts share.
 *
 * ── CREDENTIALS COME FROM THE ENVIRONMENT, ALWAYS ───────────────────────────
 *
 * Nothing here has a default host, user or password, and nothing here writes
 * one anywhere. A deployment credential in a repository is a deployment
 * credential on GitHub, and this repository is pushed.
 *
 *     HOSTINGER_SSH_HOST      147.x.x.x
 *     HOSTINGER_SSH_PORT      65002
 *     HOSTINGER_SSH_USER      uXXXXXXXXX
 *     HOSTINGER_SSH_PASSWORD  …            (or)
 *     HOSTINGER_SSH_KEY       /path/to/private/key
 *
 * A key is better than a password and is supported first: it cannot be
 * shoulder-read from a shell history, it can be revoked on its own, and it does
 * not have to be retyped into every terminal that runs a deploy.
 *
 * ── WHY A LIBRARY RATHER THAN `ssh`/`scp` ───────────────────────────────────
 *
 * OpenSSH deliberately refuses to read a password from anything but a
 * terminal, so a password-authenticated deploy cannot be scripted with it at
 * all — and `sshpass` is not installed on a Windows developer machine. Keys
 * would avoid the problem, and until one is installed on the account this is
 * what makes an automated, reviewable deployment possible.
 */

import fs from "node:fs";
import { Client } from "ssh2";

export function sshConfig() {
  const host = process.env.HOSTINGER_SSH_HOST;
  const user = process.env.HOSTINGER_SSH_USER;
  const password = process.env.HOSTINGER_SSH_PASSWORD;
  const keyPath = process.env.HOSTINGER_SSH_KEY;

  const missing = [];
  if (!host) missing.push("HOSTINGER_SSH_HOST");
  if (!user) missing.push("HOSTINGER_SSH_USER");
  if (!password && !keyPath) missing.push("HOSTINGER_SSH_PASSWORD or HOSTINGER_SSH_KEY");

  if (missing.length > 0) {
    console.error(
      `Missing: ${missing.join(", ")}.\n\n` +
        `These are never stored in the repository. Set them in the shell that runs the\n` +
        `deploy, or in a file outside the repository that you source first.`,
    );
    process.exit(1);
  }

  return {
    host,
    port: Number(process.env.HOSTINGER_SSH_PORT ?? 65002),
    username: user,
    ...(keyPath ? { privateKey: fs.readFileSync(keyPath) } : { password }),
    readyTimeout: 30_000,
  };
}

/** Opens a connection and hands it to `body`, closing it however that ends. */
export async function withSsh(body) {
  const client = new Client();
  const config = sshConfig();

  await new Promise((resolve, reject) => {
    client.on("ready", resolve);
    client.on("error", reject);
    client.connect(config);
  });

  try {
    return await body({
      /**
       * Runs a command and resolves with its output and exit code.
       *
       * Output is returned rather than streamed so a caller can decide what to
       * print. A deploy that echoes every line of `npm ci` buries the one line
       * that matters.
       */
      run: (command, { echo = false } = {}) =>
        new Promise((resolve, reject) => {
          client.exec(command, (err, stream) => {
            if (err) return reject(err);
            let out = "";
            stream.on("data", (d) => {
              out += d;
              if (echo) process.stdout.write(d);
            });
            stream.stderr.on("data", (d) => {
              out += d;
              if (echo) process.stderr.write(d);
            });
            stream.on("close", (code) => resolve({ code: code ?? 0, out }));
          });
        }),

      /** Uploads one local file. */
      put: (localPath, remotePath) =>
        new Promise((resolve, reject) => {
          client.sftp((err, sftp) => {
            if (err) return reject(err);
            sftp.fastPut(localPath, remotePath, (putErr) => {
              if (putErr) reject(putErr);
              else resolve();
            });
          });
        }),

      /** Writes a string straight to a remote file, without a local temp file. */
      write: (contents, remotePath) =>
        new Promise((resolve, reject) => {
          client.sftp((err, sftp) => {
            if (err) return reject(err);
            const stream = sftp.createWriteStream(remotePath);
            stream.on("close", resolve);
            stream.on("error", reject);
            stream.end(contents);
          });
        }),
    });
  } finally {
    client.end();
  }
}

/** Fails loudly, with the command's own output, rather than continuing. */
export async function mustRun(ssh, command, description) {
  const { code, out } = await ssh.run(command);
  if (code !== 0) {
    throw new Error(`${description} failed (exit ${code}):\n${out.trim()}`);
  }
  return out;
}
