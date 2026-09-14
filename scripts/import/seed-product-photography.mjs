/** Retained command name; stock photography must never populate saleable SKU media. */
console.error(
  "Stock-photo SKU seeding is disabled. Upload merchant photographs in the product media editor. See docs/frontend/image-mapping.md.",
);
process.exitCode = 1;
