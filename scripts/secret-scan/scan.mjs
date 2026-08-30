/**
 * Secret scan.
 *
 * Runs as part of `npm run verify`, so a credential cannot reach a commit
 * quietly. Git history is permanent: a secret committed once is a secret
 * rotated, not a secret deleted.
 *
 * Deliberately narrow patterns. A scanner that cries wolf gets bypassed, which
 * is worse than no scanner at all.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  ".react-router",
  ".wrangler",
  "coverage",
  "playwright-report",
  "test-results",
]);

const SKIP_FILES = new Set(["package-lock.json", "worker-configuration.d.ts"]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
  ".env",
  ".txt",
  ".csv",
]);

const PATTERNS = [
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Stripe secret key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Cloudflare global API key", re: /\b[a-f0-9]{37}\b/ },
  // An Italian IBAN is 27 characters. A real one in source is merchant banking
  // data, which belongs in an encrypted setting and never in the repository.
  { name: "Italian IBAN", re: /\bIT\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b/ },
  {
    name: "assigned secret",
    re: /\b(?:BETTER_AUTH_SECRET|SETTINGS_ENCRYPTION_KEY|TURNSTILE_SECRET_KEY|RESEND_API_KEY|CLOUDFLARE_D1_TOKEN)\s*[:=]\s*["'][^"'\s]{8,}["']/,
  },
];

// Example files exist to show the SHAPE of a variable. They must stay empty,
// and that is checked separately below.
const EXAMPLE_FILES = new Set([".env.example", ".dev.vars.example"]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

const findings = [];

for (const file of walk(".")) {
  const base = file.split(/[\\/]/).pop();
  if (SKIP_FILES.has(base)) continue;

  const ext = extname(file);
  if (ext && !TEXT_EXTENSIONS.has(ext) && !EXAMPLE_FILES.has(base)) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // An example file with a value in it is a leak waiting to happen.
  if (EXAMPLE_FILES.has(base)) {
    for (const [index, line] of content.split("\n").entries()) {
      const match = /^([A-Z_]+)=(.+)$/.exec(line.trim());
      if (match && match[2].trim() !== "" && !match[2].startsWith("http://localhost")) {
        findings.push({
          file,
          line: index + 1,
          name: `value in example file (${match[1]})`,
        });
      }
    }
    continue;
  }

  for (const { name, re } of PATTERNS) {
    for (const [index, line] of content.split("\n").entries()) {
      // The scanner's own pattern definitions are not findings.
      if (file.includes("secret-scan")) continue;
      if (re.test(line)) findings.push({ file, line: index + 1, name });
    }
  }
}

if (findings.length > 0) {
  console.error("SECRET SCAN FAILED\n");
  for (const f of findings) {
    console.error(`  ${f.file.replace(/\\/g, "/")}:${f.line} — ${f.name}`);
  }
  console.error(
    "\nRemove the value. If it was ever committed, ROTATE it: git history is permanent.",
  );
  process.exit(1);
}

console.log("Secret scan clean.");
