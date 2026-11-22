import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { commitSampleCheckout, seedSampleCheckoutFixture } from "./fixtures/sample-firestore-checkout.mjs";
import { decideSampleOrder } from "./fixtures/sample-order-confirmation.mjs";

const projectId = "tejuboss-rules-test";
let app, db;
before(async () => { app = initializeApp({ projectId }, "sample-checkout-emulator-tests"); db = getFirestore(app); });
after(async () => { await deleteApp(app); });

function makeRequest({ key = "sample-order-key", quantity = 6, name = "Sample Buyer" } = {}) {
  return {
    idempotencyKey: key,
    items: [{ productId: "sample-led-bulb", variantId: "warm-white", sellingOptionId: "single-piece", quantity }],
    customer: { name, phone: "08000000000" },
    fulfilment: { method: "delivery", address: "Sample address, Ibadan", area: "ibadan-central" }
  };
}
async function fixture(options) {
  const id = randomUUID();
  const root = await seedSampleCheckoutFixture(db, id, options);
  return { id, root };
}
async function place(db, id, scope, request, now = 1000) {
  return commitSampleCheckout({ db, fixtureId: id, scopeId: scope, request, now });
}

test("placing an order creates a pending order but does not deduct or reserve stock", async () => {
  const { id, root } = await fixture();
  const result = await place(db, id, "submit-only-scope", makeRequest(), 1000);
  assert.equal(result.outcome, "created");
  assert.equal(result.inventoryChanged, false);
  assert.equal(result.movementCount, 0);
  assert.equal((await root.collection("orders").doc(result.orderId).get()).data().status, "awaiting_confirmation");
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 0);
  assert.equal((await root.collection("inventory").doc("sealed-cartons").get()).data().quantityOnHand, 10);
  assert.equal((await root.collection("movements").get()).size, 0);
});

test("confirmation atomically deducts stock and records break-pack plus sale", async () => {
  const { id, root } = await fixture();
  const order = await place(db, id, "confirm-stock-scope", makeRequest(), 2000);
  const result = await decideSampleOrder({ db, fixtureId: id, orderId: order.orderId, decision: "confirm", now: 3000 });
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.inventoryChanged, true);
  assert.equal(result.stock.looseUnitsAfter, 42);
  assert.equal(result.stock.sealedPackagesAfter, 9);
  assert.equal((await root.collection("orders").doc(order.orderId).get()).data().status, "confirmed");
  assert.equal((await root.collection("movements").get()).size, 2);
});

test("rejecting an order leaves inventory and movement ledger unchanged", async () => {
  const { id, root } = await fixture();
  const order = await place(db, id, "reject-no-stock-scope", makeRequest(), 4000);
  const result = await decideSampleOrder({ db, fixtureId: id, orderId: order.orderId, decision: "reject", now: 5000 });
  assert.equal(result.nextStatus, "rejected");
  assert.equal(result.inventoryChanged, false);
  assert.equal((await root.collection("inventory").doc("sealed-cartons").get()).data().quantityOnHand, 10);
  assert.equal((await root.collection("movements").get()).size, 0);
});

test("repeated confirmation returns already-applied and cannot deduct twice", async () => {
  const { id, root } = await fixture();
  const order = await place(db, id, "repeat-confirm-scope", makeRequest(), 6000);
  await decideSampleOrder({ db, fixtureId: id, orderId: order.orderId, decision: "confirm", now: 7000 });
  const replay = await decideSampleOrder({ db, fixtureId: id, orderId: order.orderId, decision: "confirm", now: 8000 });
  assert.equal(replay.outcome, "already_applied");
  assert.equal(replay.inventoryChanged, false);
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 42);
  assert.equal((await root.collection("movements").get()).size, 2);
});

test("confirmation fails without changing order when stock is insufficient", async () => {
  const { id, root } = await fixture({ looseUnits: 0, sealedCartons: 0 });
  const order = await place(db, id, "empty-stock-confirm-scope", makeRequest(), 9000);
  await assert.rejects(
    decideSampleOrder({ db, fixtureId: id, orderId: order.orderId, decision: "confirm", now: 10000 }),
    error => error.code === "FAILED_PRECONDITION"
  );
  assert.equal((await root.collection("orders").doc(order.orderId).get()).data().status, "awaiting_confirmation");
  assert.equal((await root.collection("movements").get()).size, 0);
});

test("same idempotency key and payload replays original order without stock mutation", async () => {
  const { id, root } = await fixture();
  const first = await place(db, id, "same-guest-scope", makeRequest(), 11000);
  const replay = await place(db, id, "same-guest-scope", makeRequest(), 12000);
  assert.equal(replay.outcome, "replay");
  assert.equal(replay.orderId, first.orderId);
  assert.equal((await root.collection("orders").get()).size, 1);
  assert.equal((await root.collection("inventory").doc("sealed-cartons").get()).data().quantityOnHand, 10);
});

test("same idempotency key with changed quantity is rejected", async () => {
  const { id, root } = await fixture();
  await place(db, id, "conflict-guest-scope", makeRequest(), 13000);
  await assert.rejects(place(db, id, "conflict-guest-scope", makeRequest({ quantity: 7 }), 14000), error => error.code === "ALREADY_EXISTS");
  assert.equal((await root.collection("orders").get()).size, 1);
});

test("current catalogue price is snapshotted at order placement", async () => {
  const { id, root } = await fixture({ priceMinor: 150000 });
  const productRef = root.collection("products").doc("sample-led-bulb");
  const product = (await productRef.get()).data();
  product.variants[0].sellingOptions[0].priceMinor = 175000;
  await productRef.set(product);
  const result = await place(db, id, "fresh-price-scope", makeRequest({ quantity: 2 }), 15000);
  assert.equal(result.grandTotalMinor, 450000);
  const order = (await root.collection("orders").doc(result.orderId).get()).data();
  assert.equal(order.lines[0].appliedUnitPriceMinor, 175000);
  assert.equal(order.status, "awaiting_confirmation");
});

test("quantity tiers are read from trusted fixture and snapshotted on pending order", async () => {
  const quantityTierRules = [{
    id: "sample-piece-bulk", productId: "sample-led-bulb", variantId: "warm-white",
    rule: {
      id: "piece-12-plus", enabled: true, qualificationBasis: "selected_option_quantity",
      aggregateAcrossOptions: false, eligibleSellingOptionIds: ["single-piece"], pricingMode: "threshold",
      tiers: [{ id: "twelve-plus", minimumQuantity: 12, priceBySellingOptionId: { "single-piece": 140000 } }]
    }
  }];
  const { id, root } = await fixture({ quantityTierRules });
  const result = await place(db, id, "tier-transaction-scope", makeRequest({ key: "tier-order", quantity: 12 }), 16000);
  assert.equal(result.grandTotalMinor, 1780000);
  const order = (await root.collection("orders").doc(result.orderId).get()).data();
  assert.equal(order.pricingConfigVersion, "fixture-pricing-v1");
  assert.equal(order.appliedTierRules.length, 1);
  assert.equal(order.appliedTierRules[0].tierId, "twelve-plus");
  assert.equal(order.lines[0].totalMinor, 1680000);
  assert.equal(order.lines[0].quantityTierDiscountMinor, 120000);
  assert.equal(order.lines[0].quantityTier.qualificationQuantity, 12);
});

test("two pending orders cannot both confirm against the last carton", async () => {
  const { id, root } = await fixture({ looseUnits: 0, sealedCartons: 1 });
  const a = await place(db, id, "concurrent-scope-a", makeRequest({ key: "confirm-a", quantity: 30 }), 17000);
  const b = await place(db, id, "concurrent-scope-b", makeRequest({ key: "confirm-b", quantity: 30 }), 17000);
  const outcomes = await Promise.allSettled([
    decideSampleOrder({ db, fixtureId: id, orderId: a.orderId, decision: "confirm", now: 18000 }),
    decideSampleOrder({ db, fixtureId: id, orderId: b.orderId, decision: "confirm", now: 18000 })
  ]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(x => x.status === "rejected").length, 1);
  assert.equal((await root.collection("movements").get()).size, 2);
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 18);
  assert.equal((await root.collection("inventory").doc("sealed-cartons").get()).data().quantityOnHand, 0);
});
