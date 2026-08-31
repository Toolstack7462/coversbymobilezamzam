/**
 * Types for schema-order.mjs.
 *
 * The module stays plain JavaScript because it is imported by scripts that node
 * runs directly, with no build step — a backup tool that needs compiling before
 * it can take a backup is a tool that fails on the day it is needed most. Its
 * unit tests are TypeScript, so the shapes are declared here by hand.
 */

/** A row of `SELECT name, sql FROM sqlite_master WHERE type = 'table'`. */
export interface SchemaRow {
  name: string;
  sql: string;
}

export function parentsOf(name: string, sql: string): Set<string>;
export function selfReferencing(rows: SchemaRow[]): string[];
export function dependencyOrder(tables: string[], rows: SchemaRow[]): string[];
export function virtualTables(rows: SchemaRow[]): string[];
export function shadowTables(rows: SchemaRow[]): string[];
