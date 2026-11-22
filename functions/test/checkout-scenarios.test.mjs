import test from "node:test";
import assert from "node:assert/strict";
import { calculateCheckoutQuote } from "../src/domain/checkout-quote.mjs";
import { planLooseStockSale } from "../src/domain/inventory-planning.mjs";
import {
  buildIdempotencyRecord,
  inspectIdempotencyReplay,
  createTrackingCredential,
  hashTrackingCredential
} from "../src/domain/order-security.mjs";
import {
  sampleProducts,
  sampleDeliveryPolicy,
  sampleInventory
} from "./fixtures/sample-tejuboss-data.mjs";

function request({ quantity = 6, option = "single-piece", method = "delivery" } = {}) {
  return {
    idempotencyKey: "fixture-checkout-001",
    items: [{
      productId: "sample-led-bulb",
      variantId: "warm-white",
      sellingOptionId: option,
      quantity
    }],
    customer: { name: "Sample Buyer", phone: "08000000000" },
    fulfilment: method === "delivery"
      ? { method, address: "Sample address, Ibadan", area: "ibadan-central" }
      : { method }
  };
}

test("sample six-piece delivery quote uses trusted price and delivery policy", () => {
  const quote = calculateCheckoutQuote({
    request: request(),
    productsById: sampleProducts,
    deliveryPolicy: sampleDeliveryPolicy
  });
  assert.equal(quote.merchandiseTotalMinor, 900000);
  assert.equal(quote.deliveryFeeMinor, 100000);
  assert.equal(quote.grandTotalMinor, 1000000);
  assert.equal(quote.checkoutReady, true);
});

test("sample carton option prices a carton and consumes exactly 48 base pieces", () => {
  const quote = calculateCheckoutQuote({
    request: request({ quantity: 2, option: "sealed-carton", method: "pickup" }),
    productsById: sampleProducts,
    deliveryPolicy: null
  });
  assert.equal(quote.lines[0].stockUnitsConsumed, 96);
  assert.equal(quote.merchandiseTotalMinor, 12000000);
  assert.equal(quote.deliveryFeeMinor, 0);
});

test("sample six-piece sale opens one carton and leaves 9 cartons plus 42 loose pieces", () => {
  const plan = planLooseStockSale({
    requestedUnits: 6,
    looseUnits: sampleInventory.loosePieces,
    sealedPackages: sampleInventory.sealedCartons,
    unitsPerSealedPackage: sampleInventory.unitsPerSealedCarton
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.packagesToOpen, 1);
  assert.equal(plan.sealedPackagesAfter, 9);
  assert.equal(plan.looseUnitsAfter, 42);
  assert.deepEqual(plan.movements.map(x => x.type), ["break_pack", "sale"]);
});

test("sample sale fails safely when total physical stock is insufficient", () => {
  const plan = planLooseStockSale({
    requestedUnits: 500,
    looseUnits: 0,
    sealedPackages: 10,
    unitsPerSealedPackage: 48
  });
  assert.equal(plan.feasible, false);
  assert.equal(plan.reason, "INSUFFICIENT_STOCK");
  assert.deepEqual(plan.movements, []);
  assert.equal(plan.sealedPackagesAfter, 10);
  assert.equal(plan.looseUnitsAfter, 0);
});

test("same sample checkout key and payload is replayable, changed payload conflicts", () => {
  const first = buildIdempotencyRecord({
    scopeId: "sample-guest-session",
    idempotencyKey: "fixture-checkout-001",
    payload: request()
  });
  assert.deepEqual(inspectIdempotencyReplay(null, first), { outcome: "new" });
  assert.deepEqual(
    inspectIdempotencyReplay({
      requestFingerprint: first.requestFingerprint,
      status: "completed",
      orderId: "sample-order-001"
    }, first),
    { outcome: "replay", orderId: "sample-order-001" }
  );
  const changed = buildIdempotencyRecord({
    scopeId: "sample-guest-session",
    idempotencyKey: "fixture-checkout-001",
    payload: request({ quantity: 7 })
  });
  assert.deepEqual(
    inspectIdempotencyReplay({
      requestFingerprint: first.requestFingerprint,
      status: "completed",
      orderId: "sample-order-001"
    }, changed),
    { outcome: "conflict" }
  );
});

test("tracking credential stores a hash and never uses the raw token as the lookup key", () => {
  const credential = createTrackingCredential();
  assert.equal(hashTrackingCredential(credential.rawToken), credential.tokenHash);
  assert.notEqual(credential.rawToken, credential.tokenHash);
  assert.match(credential.tokenHash, /^[a-f0-9]{64}$/);
});
