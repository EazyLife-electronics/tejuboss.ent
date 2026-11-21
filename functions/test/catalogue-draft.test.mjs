import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalogueDraft, nairaToKobo } from "../src/domain/catalogue-draft.mjs";

const draft = () => ({
  name: "Rice",
  category: "Groceries",
  brand: "Example",
  description: "Long grain rice",
  published: false,
  variants: [{
    id: "variant_rice",
    active: true,
    stockUnit: { code: "piece", label: "Piece" },
    quantityPrecision: 0,
    sellingOptions: [{
      id: "option_piece",
      unitCode: "piece",
      displayName: "Piece",
      stockUnitsPerSaleUnit: 1,
      minimumOrderQuantity: 1,
      orderQuantityStep: 1,
      active: true,
      priceMinor: 250000
    }, {
      id: "option_bag",
      unitCode: "bag",
      displayName: "Bag of 50kg",
      stockUnitsPerSaleUnit: 50,
      minimumOrderQuantity: 1,
      orderQuantityStep: 1,
      active: true,
      priceMinor: 12000000
    }]
  }]
});

test("accepts a valid unpublished structured catalogue draft", () => {
  assert.deepEqual(validateCatalogueDraft(draft()), { valid: true, issues: [] });
});

test("requires product identity and explicit publication state", () => {
  const value = draft();
  value.name = " ";
  delete value.published;
  const result = validateCatalogueDraft(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.path === "name"));
  assert.ok(result.issues.some(issue => issue.path === "published"));
});

test("rejects duplicate and incomplete structured selling options", () => {
  const value = draft();
  value.variants[0].sellingOptions[1].id = "option_piece";
  value.variants[0].sellingOptions[1].stockUnitsPerSaleUnit = 0;
  const result = validateCatalogueDraft(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.path.endsWith(".id")));
  assert.ok(result.issues.some(issue => issue.path.endsWith(".stockUnitsPerSaleUnit")));
});

test("converts Naira to integer kobo safely", () => {
  assert.equal(nairaToKobo("1250.50"), 125050);
  assert.equal(nairaToKobo(0), 0);
  assert.throws(() => nairaToKobo("-1"));
  assert.throws(() => nairaToKobo("1.001"));
});
