import test from "node:test";
import assert from "node:assert/strict";
import { calculateCheckoutQuote } from "../src/domain/checkout-quote.mjs";

const products = new Map([["lamp", {
  published: true,
  variants: [{
    id: "white",
    active: true,
    stockUnit: { code: "piece" },
    quantityPrecision: 0,
    sellingOptions: [{
      id: "each",
      unitCode: "piece",
      displayName: "Each",
      stockUnitsPerSaleUnit: 1,
      minimumOrderQuantity: 1,
      orderQuantityStep: 1,
      active: true,
      priceMinor: 100000
    }]
  }]
}]]);

const makeRequest = (method = "delivery") => ({
  idempotencyKey: "quote-001",
  items: [{ productId: "lamp", variantId: "white", sellingOptionId: "each", quantity: 2 }],
  customer: { name: "Test Buyer", phone: "08000000000" },
  fulfilment: method === "delivery"
    ? { method, address: "Test address", area: "ibadan-central" }
    : { method }
});

test("complete delivery quote combines trusted merchandise and configured delivery", () => {
  const quote = calculateCheckoutQuote({
    request: makeRequest(),
    productsById: products,
    deliveryPolicy: {
      enabled: true,
      version: "v1",
      method: "flat_per_order",
      baseFeeMinor: 50000,
      zoneFeesMinor: { "ibadan-central": 20000 }
    }
  });
  assert.equal(quote.merchandiseTotalMinor, 200000);
  assert.equal(quote.deliveryFeeMinor, 70000);
  assert.equal(quote.grandTotalMinor, 270000);
  assert.equal(quote.checkoutReady, true);
  assert.equal(quote.quoteStatus, "complete");
});

test("pickup quote has no delivery charge and does not require a delivery policy", () => {
  const quote = calculateCheckoutQuote({
    request: makeRequest("pickup"),
    productsById: products,
    deliveryPolicy: null
  });
  assert.equal(quote.deliveryFeeMinor, 0);
  assert.equal(quote.grandTotalMinor, 200000);
});

test("delivery quote fails closed without trusted delivery policy", () => {
  assert.throws(
    () => calculateCheckoutQuote({ request: makeRequest(), productsById: products, deliveryPolicy: null }),
    /DELIVERY_POLICY_UNAVAILABLE/
  );
});
