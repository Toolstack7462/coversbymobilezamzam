/**
 * Reports formatting problems on a file that was just written.
 *
 * Deliberately READ-ONLY. A hook runs automatically and without confirmation,
 * so it must not rewrite files, stage anything, run a database command, push or
 * deploy. It prints; a human decides.
 *
 * Exits 0 always: a formatting nit should surface, not block the work.
 */
import { execFileSync } from "node:child_process";
import { extname } from "node:path";

let payload = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) payload += chunk;

let filePath;
try {
  filePath = JSON.parse(payload)?.tool_input?.file_path;
} catch {
  process.exit(0);
}

if (!filePath) process.exit(0);
if (![".ts", ".tsx", ".js", ".mjs", ".css", ".json"].includes(extname(filePath))) process.exit(0);
if (/node_modules|\.react-router|db[\\/]migrations|package-lock/.test(filePath)) process.exit(0);

try {
  execFileSync("npx", ["prettier", "--check", filePath], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
} catch {
  console.error(
    `[format] ${filePath} is not Prettier-clean. Run: npx prettier --write "${filePath}"`,
  );
}

process.exit(0);
