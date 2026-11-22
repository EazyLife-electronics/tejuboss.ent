import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckoutInventoryDeductions } from "../src/domain/checkout-inventory-mapping.mjs";

const product = {
  published: true,
  variants: [{
    id: "fresh-produce", active: true, quantityPrecision: 3,
    sellingOptions: [
      { id: "piece", active: true, stockUnitsPerSaleUnit: 1 },
      { id: "kg", active: true, stockUnitsPerSaleUnit: 1000 }
    ]
  }]
};
const productsById = new Map([["tomato", product]]);
const mapping = (overrides = {}) => ({
  productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece",
  balanceId: "loose-balance", locationId: "ibadan-main", inventoryFormId: "loose",
  stockUnitCode: "gram", stockUnitsPerBalanceUnit: 1,
  stockUnitsPerSaleUnit: 1, sealedBalanceId: null,
  sealedInventoryFormId: null, unitsPerPackage: null, ...overrides
});

test("maps fractional selling quantities into whole canonical stock units", () => {
  const result = buildCheckoutInventoryDeductions({
    items: [{ productId: "tomato", variantId: "fresh-produce", sellingOptionId: "kg", quantity: 0.25 }],
    productsById,
    mappingRecords: [mapping({ sellingOptionId: "kg", stockUnitsPerSaleUnit: 1000 })]
  });
  assert.equal(result[0].stockUnits, 250);
});

test("coalesces basket lines using the same physical balance", () => {
  const result = buildCheckoutInventoryDeductions({
    items: [
      { productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece", quantity: 3 },
      { productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece", quantity: 4 }
    ],
    productsById,
    mappingRecords: [mapping(), mapping()]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].stockUnits, 7);
});

test("fails closed for missing or mismatched mappings", () => {
  const item = { productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece", quantity: 1 };
  assert.throws(() => buildCheckoutInventoryDeductions({ items: [item], productsById, mappingRecords: [null] }),
    /not configured/);
  assert.throws(() => buildCheckoutInventoryDeductions({
    items: [item], productsById, mappingRecords: [mapping({ stockUnitsPerSaleUnit: 48 })]
  }), /does not match/);
});

test("rejects fractional canonical stock when the configured stock unit cannot represent it", () => {
  const item = { productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece", quantity: 0.5 };
  assert.throws(() => buildCheckoutInventoryDeductions({
    items: [item], productsById, mappingRecords: [mapping()]
  }), /whole canonical stock-unit/);
});

test("rejects overlapping sealed fallback balances", () => {
  const item = { productId: "tomato", variantId: "fresh-produce", sellingOptionId: "piece", quantity: 1 };
  const m = mapping({ sealedBalanceId: "sealed-balance", sealedInventoryFormId: "carton", unitsPerPackage: 48 });
  assert.throws(() => buildCheckoutInventoryDeductions({
    items: [item, item], productsById,
    mappingRecords: [m, mapping({ ...m, balanceId: "sealed-balance", sealedBalanceId: null, sealedInventoryFormId: null, unitsPerPackage: null })]
  }), /overlapping package balances/);
});
