import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCheckoutProduct,
  resolveCheckoutSelection
} from "../src/domain/catalogue.mjs";

const validProduct = () => ({
  published: true,
  variants: [{
    id: "variant-1",
    active: true,
    stockUnit: { code: "piece", label: "Piece" },
    quantityPrecision: 0,
    sellingOptions: [
      {
        id: "piece",
        unitCode: "piece",
        displayName: "Piece",
        stockUnitsPerSaleUnit: 1,
        minimumOrderQuantity: 1,
        orderQuantityStep: 1,
        active: true,
        priceMinor: 100000
      },
      {
        id: "carton",
        unitCode: "carton",
        displayName: "Carton of 48",
        stockUnitsPerSaleUnit: 48,
        minimumOrderQuantity: 1,
        orderQuantityStep: 1,
        active: true,
        priceMinor: 4000000
      }
    ]
  }]
});

test("accepts an explicitly configured product with piece and carton options", () => {
  assert.deepEqual(validateCheckoutProduct(validProduct()), {
    valid: true,
    issues: []
  });
});

test("rejects legacy product data without structured selling options", () => {
  const legacy = {
    name: "Example item",
    inStock: true,
    variants: [{ id: "v1", price: 1000, stockQty: 20 }]
  };
  const result = validateCheckoutProduct(legacy);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => item.path === "published"));
  assert.ok(result.issues.some(item => item.path === "variants[0].sellingOptions"));
});

test("rejects a missing or invalid conversion instead of inferring from labels", () => {
  const product = validProduct();
  delete product.variants[0].sellingOptions[1].stockUnitsPerSaleUnit;
  const result = validateCheckoutProduct(product);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item =>
    item.path.endsWith("stockUnitsPerSaleUnit")
  ));
});

test("resolves selections by stable IDs only", () => {
  const selected = resolveCheckoutSelection(validProduct(), "variant-1", "carton");
  assert.equal(selected.sellingOption.stockUnitsPerSaleUnit, 48);
  assert.throws(
    () => resolveCheckoutSelection(validProduct(), "variant-1", "Carton of 48"),
    error => error.code === "SELLING_OPTION_UNAVAILABLE"
  );
});

test("rejects inactive variants and options", () => {
  const product = validProduct();
  product.variants[0].sellingOptions[0].active = false;
  assert.equal(validateCheckoutProduct(product).valid, false);
});
