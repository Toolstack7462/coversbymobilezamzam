/**
 * Single entry point for the schema. drizzle.config.ts points here, and every
 * repository imports from here so there is exactly one definition of each table.
 */
export * from "./_shared";
export * from "./auth";
export * from "./catalogue";
export * from "./compatibility";
export * from "./pricing";
export * from "./inventory";
export * from "./orders";
export * from "./payments";
export * from "./fulfilment";
export * from "./content";
export * from "./reviews";
export * from "./system";
