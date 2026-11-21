import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  commitSampleCheckout,
  seedSampleCheckoutFixture
} from "./fixtures/sample-firestore-checkout.mjs";

const projectId = "tejuboss-rules-test";
let app;
let db;

before(async () => {
  app = initializeApp({ projectId }, "sample-checkout-emulator-tests");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function makeRequest({ key = "sample-order-key", quantity = 6, name = "Sample Buyer" } = {}) {
  return {
    idempotencyKey: key,
    items: [{
      productId: "sample-led-bulb",
      variantId: "warm-white",
      sellingOptionId: "single-piece",
      quantity
    }],
    customer: { name, phone: "08000000000" },
    fulfilment: {
      method: "delivery",
      address: "Sample address, Ibadan",
      area: "ibadan-central"
    }
  };
}

async function fixture(options) {
  const id = randomUUID();
  const root = await seedSampleCheckoutFixture(db, id, options);
  return { id, root };
}

test("Firestore emulator commits order, tracking, stock and movements atomically", async () => {
  const { id, root } = await fixture();
  const result = await commitSampleCheckout({
    db, fixtureId: id, scopeId: "server-derived-sample-guest-scope",
    request: makeRequest(), now: 1000
  });

  assert.equal(result.outcome, "created");
  assert.equal(result.grandTotalMinor, 1000000);
  assert.equal(result.stock.looseUnitsAfter, 42);
  assert.equal(result.stock.sealedPackagesAfter, 9);
  assert.equal(result.movementCount, 2);
  assert.equal(result.trackingTokenHash.length, 64);
  assert.notEqual(result.trackingToken, result.trackingTokenHash);

  const order = await root.collection("orders").doc(result.orderId).get();
  const tracking = await root.collection("tracking").doc(result.trackingTokenHash).get();
  const loose = await root.collection("inventory").doc("loose-pieces").get();
  const sealed = await root.collection("inventory").doc("sealed-cartons").get();
  const movements = await root.collection("movements").get();

  assert.equal(order.exists, true);
  assert.equal(order.data().grandTotalMinor, 1000000);
  assert.equal("trackingToken" in order.data(), false);
  assert.equal(tracking.exists, true);
  assert.equal(tracking.data().orderId, result.orderId);
  assert.equal("phone" in tracking.data(), false);
  assert.equal(loose.data().quantityOnHand, 42);
  assert.equal(sealed.data().quantityOnHand, 9);
  assert.equal(movements.size, 2);
});

test("same idempotency key and request replays original order without another stock deduction", async () => {
  const { id, root } = await fixture();
  const first = await commitSampleCheckout({
    db, fixtureId: id, scopeId: "same-guest-scope",
    request: makeRequest(), now: 2000
  });
  const replay = await commitSampleCheckout({
    db, fixtureId: id, scopeId: "same-guest-scope",
    request: makeRequest(), now: 3000
  });

  assert.equal(replay.outcome, "replay");
  assert.equal(replay.orderId, first.orderId);
  assert.equal((await root.collection("orders").get()).size, 1);
  assert.equal((await root.collection("movements").get()).size, 2);
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 42);
});

test("same idempotency key with changed quantity is rejected without another order", async () => {
  const { id, root } = await fixture();
  await commitSampleCheckout({
    db, fixtureId: id, scopeId: "conflict-guest-scope",
    request: makeRequest(), now: 4000
  });
  await assert.rejects(
    commitSampleCheckout({
      db, fixtureId: id, scopeId: "conflict-guest-scope",
      request: makeRequest({ quantity: 7 }), now: 5000
    }),
    error => error.code === "ALREADY_EXISTS"
  );
  assert.equal((await root.collection("orders").get()).size, 1);
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 42);
});

test("insufficient inventory aborts every write", async () => {
  const { id, root } = await fixture({ looseUnits: 0, sealedCartons: 0 });
  await assert.rejects(
    commitSampleCheckout({
      db, fixtureId: id, scopeId: "empty-stock-scope",
      request: makeRequest(), now: 6000
    }),
    error => error.code === "FAILED_PRECONDITION"
  );
  assert.equal((await root.collection("orders").get()).size, 0);
  assert.equal((await root.collection("tracking").get()).size, 0);
  assert.equal((await root.collection("idempotency").get()).size, 0);
  assert.equal((await root.collection("movements").get()).size, 0);
  assert.equal((await root.collection("inventory").doc("loose-pieces").get()).data().quantityOnHand, 0);
});

test("checkout uses the current catalogue price read inside the transaction", async () => {
  const { id, root } = await fixture({ priceMinor: 150000 });
  const productRef = root.collection("products").doc("sample-led-bulb");
  const product = (await productRef.get()).data();
  product.variants[0].sellingOptions[0].priceMinor = 175000;
  await productRef.set(product);
  const result = await commitSampleCheckout({
    db, fixtureId: id, scopeId: "fresh-price-scope",
    request: makeRequest({ quantity: 2 }), now: 7000
  });
  assert.equal(result.grandTotalMinor, 450000);
  const order = await root.collection("orders").doc(result.orderId).get();
  assert.equal(order.data().lines[0].appliedUnitPriceMinor, 175000);
});

test("concurrent orders cannot oversell the last sealed carton", async () => {
  const { id, root } = await fixture({ looseUnits: 0, sealedCartons: 1 });
  const outcomes = await Promise.allSettled([
    commitSampleCheckout({
      db, fixtureId: id, scopeId: "concurrent-scope-a",
      request: makeRequest({ key: "concurrent-a", quantity: 30 }), now: 8000
    }),
    commitSampleCheckout({
      db, fixtureId: id, scopeId: "concurrent-scope-b",
      request: makeRequest({ key: "concurrent-b", quantity: 30 }), now: 8000
    })
  ]);

  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(x => x.status === "rejected").length, 1);
  assert.equal((await root.collection("orders").get()).size, 1);
  const loose = (await root.collection("inventory").doc("loose-pieces").get()).data();
  const sealed = (await root.collection("inventory").doc("sealed-cartons").get()).data();
  assert.equal(loose.quantityOnHand, 18);
  assert.equal(sealed.quantityOnHand, 0);
});
