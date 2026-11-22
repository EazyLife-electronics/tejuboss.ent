import test from "node:test";
import assert from "node:assert/strict";
import { calculateCatalogueLinePrice } from "../src/domain/order-pricing.mjs";

const product = {
  id: "product-1",
  published: true,
  variants: [{
    id: "variant-a",
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
        priceMinor: 4000000,
        promoPriceMinor: 3800000
      }
    ]
  }]
};

test("prices a single selling option using catalogue price, not client price", () => {
  const line = calculateCatalogueLinePrice({
    product, variantId: "variant-a", sellingOptionId: "piece", quantity: 3
  });
  assert.equal(line.totalMinor, 300000);
  assert.equal(line.stockUnitsConsumed, 3);
  assert.equal(line.pricingSource, "catalogue_base");
});

test("uses explicitly configured promotional price", () => {
  const line = calculateCatalogueLinePrice({
    product, variantId: "variant-a", sellingOptionId: "carton", quantity: 2
  });
  assert.equal(line.subtotalMinor, 8000000);
  assert.equal(line.totalMinor, 7600000);
  assert.equal(line.discountMinor, 400000);
  assert.equal(line.stockUnitsConsumed, 96);
  assert.equal(line.pricingSource, "catalogue_promotion");
});

test("rejects quantity below minimum", () => {
  const changed = structuredClone(product);
  changed.variants[0].sellingOptions[0].minimumOrderQuantity = 3;
  assert.throws(
    () => calculateCatalogueLinePrice({
      product: changed, variantId: "variant-a", sellingOptionId: "piece", quantity: 2
    }),
    error => error.code === "MINIMUM_ORDER_QUANTITY"
  );
});

test("rejects quantities that do not follow the configured step", () => {
  const changed = structuredClone(product);
  changed.variants[0].sellingOptions[0].orderQuantityStep = 2;
  assert.throws(
    () => calculateCatalogueLinePrice({
      product: changed, variantId: "variant-a", sellingOptionId: "piece", quantity: 2
    }),
    error => error.code === "INVALID_ORDER_QUANTITY_STEP"
  );
});

test("supports configured fractional quantity precision", () => {
  const changed = structuredClone(product);
  changed.variants[0].quantityPrecision = 2;
  changed.variants[0].sellingOptions[0].minimumOrderQuantity = 0.25;
  changed.variants[0].sellingOptions[0].orderQuantityStep = 0.25;
  const line = calculateCatalogueLinePrice({
    product: changed, variantId: "variant-a", sellingOptionId: "piece", quantity: 0.5
  });
  assert.equal(line.totalMinor, 50000);
  assert.equal(line.stockUnitsConsumed, 0.5);
});

test("rejects quantities beyond configured precision", () => {
  const changed = structuredClone(product);
  changed.variants[0].quantityPrecision = 2;
  assert.throws(
    () => calculateCatalogueLinePrice({
      product: changed, variantId: "variant-a", sellingOptionId: "piece", quantity: 0.123
    }),
    TypeError
  );
});

test("rejects unknown IDs instead of resolving by display label", () => {
  assert.throws(
    () => calculateCatalogueLinePrice({
      product, variantId: "variant-a", sellingOptionId: "Carton of 48", quantity: 1
    }),
    error => error.code === "SELLING_OPTION_UNAVAILABLE"
  );
});

test("rejects unsafe or invalid money values", () => {
  const changed = structuredClone(product);
  changed.variants[0].sellingOptions[0].priceMinor = Number.MAX_SAFE_INTEGER;
  assert.throws(
    () => calculateCatalogueLinePrice({
      product: changed, variantId: "variant-a", sellingOptionId: "piece", quantity: 2
    }),
    RangeError
  );
});
