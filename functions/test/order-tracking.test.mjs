import test from "node:test";
import assert from "node:assert/strict";
import { createTrackingCredential } from "../src/domain/order-security.mjs";
import { buildCustomerTrackingView, validateTrackingToken } from "../src/domain/order-tracking.mjs";

test("customer tracking view exposes lifecycle but no private customer or inventory fields", () => {
  const credential = createTrackingCredential();
  const view = buildCustomerTrackingView({
    order: {
      orderId: "order-1", status: "confirmed", paymentStatus: "unpaid",
      fulfilmentStatus: "unfulfilled", currency: "NGN", grandTotalMinor: 250000,
      createdAtMillis: 100, confirmedAtMillis: 200,
      customer: { name: "Private Name", phone: "08000000000" },
      fulfilment: { address: "Private address" }, note: "private",
      inventoryDeductions: [{ balanceId: "secret" }]
    },
    tracking: { orderId: "order-1", status: "confirmed" }
  });
  assert.equal(view.status, "confirmed");
  assert.deepEqual(view.timeline.map(x => x.event), ["order_placed", "confirmed"]);
  assert.equal("customer" in view, false);
  assert.equal("fulfilment" in view, false);
  assert.equal("inventoryDeductions" in view, false);
  assert.equal(credential.tokenHash.length, 64);
});

test("tracking token must be a high-entropy URL-safe credential", () => {
  const credential = createTrackingCredential();
  assert.equal(validateTrackingToken(credential.rawToken).length, 64);
  assert.throws(() => validateTrackingToken("order-123"), /valid tracking token/i);
});

test("tracking view rejects mismatched tracking records and unknown states", () => {
  assert.throws(() => buildCustomerTrackingView({
    order: { orderId: "a", status: "confirmed", paymentStatus: "unpaid", fulfilmentStatus: "unfulfilled" },
    tracking: { orderId: "b" }
  }));
  assert.throws(() => buildCustomerTrackingView({
    order: { orderId: "a", status: "secret", paymentStatus: "unpaid", fulfilmentStatus: "unfulfilled" },
    tracking: { orderId: "a" }
  }));
});
