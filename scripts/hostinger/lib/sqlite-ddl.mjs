/**
 * A parser for the SQLite DDL that Drizzle generates.
 *
 * This exists because the MariaDB schema must be DERIVED from the applied D1
 * migrations rather than retyped beside them. A hand-written second schema is
 * two sources of truth, and the moment they disagree the disagreement is
 * silent: the storefront works, the import works, and one nullable column
 * somewhere is a different type in production than in the tests.
 *
 * It is deliberately NOT a general SQLite parser. It understands exactly the
 * shapes Drizzle emits, and throws on anything else, because a parser that
 * quietly skips what it does not recognise drops a column.
 */

/** @typedef {{ name: string, type: string, notNull: boolean, primaryKey: boolean, default: string | null, raw: string }} Column */
/** @typedef {{ columns: string[], table: string, refColumns: string[], onDelete: string, onUpdate: string }} ForeignKey */
/** @typedef {{ name: string, table: string, columns: string[], unique: boolean, where: string | null }} Index */
/** @typedef {{ name: string, columns: Column[], foreignKeys: ForeignKey[], checks: string[], primaryKey: string[] }} Table */

const STATEMENT_SEPARATOR = "--> statement-breakpoint";

/**
 * Splits a migration file into statements.
 *
 * Drizzle marks its own boundaries, which is more reliable than splitting on
 * `;` — a trigger body is full of semicolons and splitting on them shreds it.
 */
export function splitStatements(sql) {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => stripComments(s).trim())
    .filter((s) => s !== "" && s !== ";");
}

/** Removes `--` line comments, preserving anything inside a string literal. */
function stripComments(sql) {
  const out = [];
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (!inString && ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      if (end === -1) break;
      i = end;
      out.push("\n");
      continue;
    }
    out.push(ch);
  }
  return out.join("");
}

/**
 * Splits a parenthesised body on top-level commas.
 *
 * `FOREIGN KEY (a,b) REFERENCES t(c,d)` contains commas that are not column
 * separators, so depth has to be tracked rather than assumed.
 */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  let inString = false;
  for (const ch of body) {
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

const ident = (s) => s.replace(/^[`"[]|[`"\]]$/g, "");

/** @returns {Table | null} */
export function parseCreateTable(statement) {
  const match =
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w-]+[`"\]]?)\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(
      statement.trim(),
    );
  if (!match) return null;

  const name = ident(match[1]);
  const parts = splitTopLevel(match[2]);

  /** @type {Table} */
  const table = { name, columns: [], foreignKeys: [], checks: [], primaryKey: [] };

  for (const part of parts) {
    if (/^FOREIGN\s+KEY/i.test(part)) {
      const fk =
        /^FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"[]?[\w-]+[`"\]]?)\s*\(([^)]+)\)(.*)$/i.exec(
          part,
        );
      if (!fk) throw new Error(`Unparsed FOREIGN KEY in ${name}: ${part}`);
      const tail = fk[4] ?? "";
      table.foreignKeys.push({
        columns: fk[1].split(",").map((c) => ident(c.trim())),
        table: ident(fk[2]),
        refColumns: fk[3].split(",").map((c) => ident(c.trim())),
        onDelete: (
          /ON\s+DELETE\s+(no\s+action|cascade|set\s+null|restrict|set\s+default)/i.exec(
            tail,
          )?.[1] ?? "no action"
        ).toUpperCase(),
        onUpdate: (
          /ON\s+UPDATE\s+(no\s+action|cascade|set\s+null|restrict|set\s+default)/i.exec(
            tail,
          )?.[1] ?? "no action"
        ).toUpperCase(),
      });
      continue;
    }

    if (/^CHECK\s*\(/i.test(part)) {
      table.checks.push({
        name: null,
        expression: part
          .replace(/^CHECK\s*\(/i, "")
          .replace(/\)\s*$/, "")
          .trim(),
      });
      continue;
    }

    /*
     * A named CHECK: `CONSTRAINT "x" CHECK(...)`.
     *
     * The name matters and is carried across. create-order.ts recognises the
     * oversell failure by matching `inventory_levels_reserved_bounds` in the
     * driver's error message; an anonymous constraint would still reject the
     * write, but the application could no longer tell "somebody took the last
     * unit" apart from "the database is broken", and the customer would get a
     * 500 instead of "out of stock".
     */
    const namedCheck = /^CONSTRAINT\s+([`"[]?[\w-]+[`"\]]?)\s+CHECK\s*\(([\s\S]*)\)\s*$/i.exec(
      part,
    );
    if (namedCheck) {
      table.checks.push({ name: ident(namedCheck[1]), expression: namedCheck[2].trim() });
      continue;
    }

    if (/^PRIMARY\s+KEY\s*\(/i.test(part)) {
      table.primaryKey = /\(([^)]+)\)/
        .exec(part)[1]
        .split(",")
        .map((c) => ident(c.trim()));
      continue;
    }

    if (/^(UNIQUE|CONSTRAINT)\b/i.test(part)) {
      throw new Error(`Unsupported table-level constraint in ${name}: ${part}`);
    }

    // A column definition.
    const col = /^([`"[]?[\w-]+[`"\]]?)\s+([A-Za-z]+)(.*)$/s.exec(part);
    if (!col) throw new Error(`Unparsed column in ${name}: ${part}`);
    const rest = col[3] ?? "";
    const defaultMatch = /DEFAULT\s+((?:'(?:[^']|'')*')|\([^)]*\)|[^\s,]+)/i.exec(rest);
    const isPk = /PRIMARY\s+KEY/i.test(rest);

    table.columns.push({
      name: ident(col[1]),
      type: col[2].toLowerCase(),
      notNull: /NOT\s+NULL/i.test(rest),
      primaryKey: isPk,
      default: defaultMatch ? defaultMatch[1] : null,
      raw: part,
    });

    if (isPk) table.primaryKey = [ident(col[1])];
  }

  if (table.columns.length === 0) throw new Error(`No columns parsed for ${name}`);
  return table;
}

/** @returns {Index | null} */
export function parseCreateIndex(statement) {
  const match =
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w-]+[`"\]]?)\s+ON\s+([`"[]?[\w-]+[`"\]]?)\s*\(([^)]+)\)\s*(?:WHERE\s+([\s\S]+?))?\s*;?\s*$/i.exec(
      statement.trim(),
    );
  if (!match) return null;
  return {
    unique: Boolean(match[1]),
    name: ident(match[2]),
    table: ident(match[3]),
    columns: match[4].split(",").map((c) => ident(c.trim())),
    where: match[5] ? match[5].trim() : null,
  };
}

export function parseAlterTableAddColumn(statement) {
  const match =
    /^ALTER\s+TABLE\s+([`"[]?[\w-]+[`"\]]?)\s+ADD\s+(?:COLUMN\s+)?([`"[]?[\w-]+[`"\]]?)\s+([A-Za-z]+)(.*?);?\s*$/is.exec(
      statement.trim(),
    );
  if (!match) return null;
  const rest = match[4] ?? "";
  const defaultMatch = /DEFAULT\s+((?:'(?:[^']|'')*')|\([^)]*\)|[^\s,]+)/i.exec(rest);
  return {
    table: ident(match[1]),
    column: {
      name: ident(match[2]),
      type: match[3].toLowerCase(),
      notNull: /NOT\s+NULL/i.test(rest),
      primaryKey: false,
      default: defaultMatch ? defaultMatch[1] : null,
      raw: statement,
    },
  };
}

export function classifyStatement(statement) {
  const head = statement.trim().slice(0, 60).toUpperCase();
  if (head.startsWith("CREATE TABLE")) return "create_table";
  if (head.startsWith("CREATE VIRTUAL TABLE")) return "create_virtual_table";
  if (head.startsWith("CREATE UNIQUE INDEX") || head.startsWith("CREATE INDEX"))
    return "create_index";
  if (head.startsWith("CREATE TRIGGER")) return "create_trigger";
  if (head.startsWith("ALTER TABLE") && /ADD\s+(COLUMN\s+)?/i.test(statement)) return "add_column";
  if (head.startsWith("ALTER TABLE")) return "alter_table";
  if (head.startsWith("DROP")) return "drop";
  if (head.startsWith("INSERT")) return "insert";
  if (head.startsWith("UPDATE")) return "update";
  if (head.startsWith("DELETE")) return "delete";
  if (head.startsWith("PRAGMA")) return "pragma";
  return "unknown";
}
