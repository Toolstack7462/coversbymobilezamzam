import { describe, expect, it } from "vitest";

import {
  ACCESSORY_TYPES,
  ACCESSORY_TYPE_LABELS,
  SPEC_COLUMNS,
  accessoryTypeLabel,
  isAccessoryType,
  parseSpecValues,
  specColumnAllowed,
  specFieldsFor,
} from "~/domain/catalogue/product-types";

/**
 * Product-type templates decide which fields the product editor offers, and —
 * more importantly — which columns a submitted form is allowed to write. The
 * second is a security property, not a convenience one: without it a crafted
 * post could set a battery capacity on a phone case, and the column names are
 * interpolated into SQL because an identifier cannot be bound as a parameter.
 */

describe("the type list", () => {
  it("labels every type", () => {
    for (const type of ACCESSORY_TYPES) {
      expect(ACCESSORY_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("recognises only the known types", () => {
    expect(isAccessoryType("charger")).toBe(true);
    expect(isAccessoryType("Charger")).toBe(false);
    expect(isAccessoryType("")).toBe(false);
    expect(isAccessoryType(null)).toBe(false);
    expect(isAccessoryType("'; DROP TABLE products; --")).toBe(false);
  });

  it("names the missing case rather than showing a blank", () => {
    expect(accessoryTypeLabel(null)).toBe("Tipo non impostato");
    expect(accessoryTypeLabel("nonsense")).toBe("Tipo non impostato");
    expect(accessoryTypeLabel("cable")).toBe("Cavi");
  });
});

describe("which fields each type asks for", () => {
  it("asks a cable for its length and connectors", () => {
    const columns = specFieldsFor("cable").map((f) => f.column);
    expect(columns).toEqual(["length_mm", "connector"]);
  });

  it("asks a power bank for its capacity", () => {
    expect(specFieldsFor("powerbank").map((f) => f.column)).toContain("capacity_mah");
  });

  it("does NOT ask a phone case for a battery capacity", () => {
    // The example from the brief. A case has no battery, and a form that asks
    // for one is a form that teaches the merchant to leave fields blank.
    expect(specFieldsFor("case").map((f) => f.column)).not.toContain("capacity_mah");
    expect(specFieldsFor("screen_protector").map((f) => f.column)).not.toContain("capacity_mah");
  });

  it("asks a screen protector how many are in the pack", () => {
    expect(specFieldsFor("screen_protector").map((f) => f.column)).toContain("pack_size");
  });

  it("offers nothing at all for an unset or unknown type", () => {
    // Not a default set. A guessed set collects the wrong data confidently.
    expect(specFieldsFor(null)).toEqual([]);
    expect(specFieldsFor("")).toEqual([]);
    expect(specFieldsFor("something-new")).toEqual([]);
  });

  it("only ever names columns that exist on product_variants", () => {
    for (const type of ACCESSORY_TYPES) {
      for (const field of specFieldsFor(type)) {
        expect(SPEC_COLUMNS).toContain(field.column);
      }
    }
  });

  it("gives every type at least one field", () => {
    for (const type of ACCESSORY_TYPES) {
      expect(specFieldsFor(type).length).toBeGreaterThan(0);
    }
  });
});

describe("the write-side guard", () => {
  it("permits only the columns that type declares", () => {
    expect(specColumnAllowed("cable", "length_mm")).toBe(true);
    expect(specColumnAllowed("cable", "capacity_mah")).toBe(false);
    expect(specColumnAllowed("case", "capacity_mah")).toBe(false);
  });

  it("permits nothing at all when the type is unknown", () => {
    for (const column of SPEC_COLUMNS) {
      expect(specColumnAllowed(null, column)).toBe(false);
      expect(specColumnAllowed("nonsense", column)).toBe(false);
    }
  });

  it("refuses a column name that is not a column", () => {
    // These names are interpolated into an UPDATE, so this is the test that
    // matters most in this file.
    expect(specColumnAllowed("cable", "sku = 'x', length_mm")).toBe(false);
    expect(specColumnAllowed("cable", "id")).toBe(false);
    expect(specColumnAllowed("cable", "1=1")).toBe(false);
  });
});

describe("reading what was submitted", () => {
  const read = (values: Record<string, string>) => (name: string) => values[name] ?? null;

  it("parses a whole number", () => {
    const { values, errors } = parseSpecValues("powerbank", read({ capacity_mah: "10000" }));
    expect(errors).toEqual([]);
    expect(values.capacity_mah).toBe(10000);
  });

  it("accepts the thousands separator an Italian keyboard produces", () => {
    // "10.000" means ten thousand here, not ten. Refusing a number somebody
    // typed correctly for their locale is the interface being wrong.
    expect(parseSpecValues("powerbank", read({ capacity_mah: "10.000" })).values.capacity_mah).toBe(
      10000,
    );
    expect(parseSpecValues("powerbank", read({ capacity_mah: "10 000" })).values.capacity_mah).toBe(
      10000,
    );
  });

  it("clears a column when the field is emptied", () => {
    // A merchant who deletes a wrong number and saves must end up with no
    // number, not with the old one still there.
    const { values, errors } = parseSpecValues("powerbank", read({ capacity_mah: "" }));
    expect(errors).toEqual([]);
    expect(values.capacity_mah).toBeNull();
  });

  it("reports a non-numeric value instead of storing a quiet zero", () => {
    // `Number("abc")` is NaN, and NaN written to an integer column is 0 —
    // a real specification that happens to be wrong.
    const { errors } = parseSpecValues("powerbank", read({ capacity_mah: "abc" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Capacità");
  });

  it("rejects a value outside the range", () => {
    expect(parseSpecValues("powerbank", read({ capacity_mah: "0" })).errors).toHaveLength(1);
    expect(parseSpecValues("powerbank", read({ capacity_mah: "99999999" })).errors).toHaveLength(1);
  });

  it("rejects a fractional value where an integer is required", () => {
    expect(parseSpecValues("cable", read({ length_mm: "1,5" })).errors).toHaveLength(1);
  });

  it("does not turn a decimal point into a thousands separator", () => {
    // The trap in the other direction. Stripping every dot would read "1.5" as
    // 15 and store a perfectly plausible wrong number. Only actual thousands
    // groups are stripped; anything else fails the integer check and is
    // reported.
    expect(parseSpecValues("cable", read({ length_mm: "1.5" })).errors).toHaveLength(1);
    expect(parseSpecValues("cable", read({ length_mm: "1.500" })).values.length_mm).toBe(1500);
    expect(
      parseSpecValues("powerbank", read({ capacity_mah: "123.456" })).values.capacity_mah,
    ).toBe(123456);
  });

  it("ignores a field the type does not declare", () => {
    // The important one. A crafted form posting `capacity_mah` to a phone case
    // must not reach the UPDATE at all.
    const { values } = parseSpecValues(
      "case",
      read({ capacity_mah: "10000", dimensions_mm: "160 × 78 × 9" }),
    );
    expect(values.capacity_mah).toBeUndefined();
    expect(values.dimensions_mm).toBe("160 × 78 × 9");
  });

  it("parses nothing when the type is unknown", () => {
    const { values, errors } = parseSpecValues(null, read({ capacity_mah: "10000" }));
    expect(values).toEqual({});
    expect(errors).toEqual([]);
  });

  it("enforces the text length", () => {
    expect(parseSpecValues("cable", read({ connector: "x".repeat(61) })).errors).toHaveLength(1);
    expect(parseSpecValues("cable", read({ connector: "x".repeat(60) })).errors).toEqual([]);
  });

  it("trims but does not otherwise rewrite text", () => {
    const { values } = parseSpecValues("cable", read({ connector: "  USB-C a Lightning  " }));
    expect(values.connector).toBe("USB-C a Lightning");
  });
});
