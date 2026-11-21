import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCreateOrderRequest,
  calculateMerchandiseQuote
} from "../src/domain/checkout.mjs";

const request = {
  idempotencyKey: "checkout-attempt-001",
  items: [{
    productId: "product-1",
    variantId: "variant-a",
    sellingOptionId: "piece",
    quantity: 2
  }],
  customer: { name: "Ada Example", phone: "08000000000" },
  fulfilment: { method: "pickup" }
};

const products = new Map([["product-1", {
  published: true,
  variants: [{
    id: "variant-a",
    active: true,
    stockUnit: { code: "piece" },
    quantityPrecision: 0,
    sellingOptions: [{
      id: "piece",
      unitCode: "piece",
      displayName: "Piece",
      stockUnitsPerSaleUnit: 1,
      minimumOrderQuantity: 1,
      orderQuantityStep: 1,
      active: true,
      priceMinor: 125000
    }]
  }]
}]]);

test("validates guest checkout without requiring an account", () => {
  const value = validateCreateOrderRequest(request);
  assert.equal(value.customer.name, "Ada Example");
  assert.equal(value.fulfilment.method, "pickup");
});

test("rejects client-submitted prices and totals", () => {
  assert.throws(
    () => validateCreateOrderRequest({ ...request, totalMinor: 1 }),
    error => error.code === "INVALID_ARGUMENT"
  );
});

test("rejects prices smuggled into an item line", () => {
  const forged = structuredClone(request);
  forged.items[0].unitPriceMinor = 1;
  assert.throws(
    () => validateCreateOrderRequest(forged),
    error => error.code === "INVALID_ARGUMENT"
  );
});

test("requires delivery address and area for delivery orders", () => {
  const delivery = structuredClone(request);
  delivery.fulfilment = { method: "delivery" };
  assert.throws(
    () => validateCreateOrderRequest(delivery),
    error => error.code === "INVALID_ARGUMENT"
  );
});

test("calculates merchandise total from trusted catalogue price", () => {
  const quote = calculateMerchandiseQuote(request, products);
  assert.equal(quote.subtotalMinor, 250000);
  assert.equal(quote.merchandiseTotalMinor, 250000);
  assert.equal(quote.currency, "NGN");
  assert.equal(quote.checkoutReady, false);
  assert.equal(quote.grandTotalMinor, null);
});

test("fails closed for an unavailable product", () => {
  assert.throws(
    () => calculateMerchandiseQuote(request, new Map()),
    error => error.code === "PRODUCT_UNAVAILABLE"
  );
});

test("rejects malformed identifiers and quantities", () => {
  const bad = structuredClone(request);
  bad.items[0].quantity = 0;
  assert.throws(
    () => validateCreateOrderRequest(bad),
    error => error.code === "INVALID_ARGUMENT"
  );
});
