import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createGuestCheckoutSession } from "../src/guest-checkout-session.mjs";
import { initializeInventoryBalance } from "../src/inventory-setup.mjs";
import { saveInventoryMapping } from "../src/inventory-mapping.mjs";
import { createGuestOrder } from "../src/guest-order.mjs";
import { decideOrder } from "../src/order-confirmation.mjs";
import { getGuestOrderTracking, recoverGuestOrderTracking } from "../src/order-tracking.mjs";
import { inventoryBalanceId } from "../src/domain/inventory-setup.mjs";
import { inventoryMappingDocumentId } from "../src/domain/inventory-mapping.mjs";
import { hashGuestSessionCredential } from "../src/domain/guest-session.mjs";
import { buildIdempotencyRecord, hashTrackingCredential } from "../src/domain/order-security.mjs";

const projectId = "tejuboss-rules-test";
let app, db;
const staff = { uid: "emulator-owner", token: { role: "owner" } };
const call = (fn, data, auth = null) => {
  if (typeof fn.run !== "function") throw new Error("Firebase callable test runner is unavailable.");
  return fn.run({ data, auth });
};

before(async () => {
  app = initializeApp({ projectId });
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("production commerce callables: open stock, map option, guest order, confirm, track and recover", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const productId = "test-grocery-" + suffix;
  const variantId = "fresh";
  const optionId = "quarter-kg";
  const locationId = "ibadan-main";
  const formId = "loose-grams-" + suffix;
  const balanceId = inventoryBalanceId({ productId, variantId, locationId, inventoryFormId: formId });
  const mappingId = inventoryMappingDocumentId({ productId, variantId, sellingOptionId: optionId });
  const productRef = db.collection("catalogueProducts").doc(productId);
  let sessionToken, orderId, trackingToken, newTrackingToken, secondOrderId, secondTrackingToken;

  await productRef.create({
    catalogueSchemaVersion: 2,
    name: "Emulator Sample Tomatoes",
    category: "Groceries",
    published: true,
    variants: [{
      id: variantId,
      active: true,
      stockUnit: { code: "gram", label: "gram" },
      quantityPrecision: 3,
      sellingOptions: [{
        id: optionId,
        unitCode: "quarter_kg",
        displayName: "Quarter kilogram",
        stockUnitsPerSaleUnit: 250,
        minimumOrderQuantity: 1,
        orderQuantityStep: 1,
        active: true,
        priceMinor: 50000
      }]
    }]
  });

  try {
    const session = await call(createGuestCheckoutSession, {});
    sessionToken = session.sessionToken;
    assert.equal(typeof sessionToken, "string");
    assert.ok(session.expiresAtMillis > Date.now());

    const opening = await call(initializeInventoryBalance, {
      productId, variantId, locationId, inventoryFormId: formId,
      formLabel: "Loose grams", stockUnitCode: "gram",
      quantityOnHand: 1000, stockUnitsPerBalanceUnit: 1,
      reason: "Emulator physical opening count", countConfirmed: true
    }, staff);
    assert.equal(opening.balanceId, balanceId);
    assert.equal(opening.quantityOnHand, 1000);

    const mapping = await call(saveInventoryMapping, {
      productId, variantId, sellingOptionId: optionId,
      locationId, inventoryFormId: formId
    }, staff);
    assert.equal(mapping.mappingId, mappingId);
    assert.equal(mapping.balanceId, balanceId);
    assert.equal(mapping.stockUnitsPerSaleUnit, 250);

    const order = await call(createGuestOrder, {
      sessionToken,
      order: {
        idempotencyKey: "grocery-" + suffix,
        items: [{ productId, variantId, sellingOptionId: optionId, quantity: 1 }],
        customer: { name: "Emulator Buyer", phone: "08000000000" },
        fulfilment: { method: "pickup" }
      }
    });
    assert.equal(order.success, true);
    assert.equal(order.outcome, "created");
    assert.equal(order.status, "awaiting_confirmation");
    assert.equal(order.grandTotalMinor, 50000);
    orderId = order.orderId;
    trackingToken = order.trackingToken;

    const orderSnap = await db.collection("orders").doc(orderId).get();
    assert.equal(orderSnap.data().status, "awaiting_confirmation");
    assert.equal(orderSnap.data().inventoryDeductions[0].stockUnits, 250);
    assert.equal((await db.collection("inventoryBalances").doc(balanceId).get()).data().quantityOnHand, 1000);
    assert.equal((await db.collection("inventoryMovements").where("orderId", "==", orderId).get()).size, 0);

    const pendingTracking = await call(getGuestOrderTracking, { trackingToken });
    assert.equal(pendingTracking.tracking.orderId, orderId);
    assert.equal(pendingTracking.tracking.status, "awaiting_confirmation");

    const confirmed = await call(decideOrder, { orderId, decision: "confirm" }, staff);
    assert.equal(confirmed.outcome, "confirmed");
    assert.equal(confirmed.inventoryDeducted, true);
    assert.equal((await db.collection("inventoryBalances").doc(balanceId).get()).data().quantityOnHand, 750);
    assert.equal((await db.collection("inventoryMovements").where("orderId", "==", orderId).get()).size, 1);

    const repeated = await call(decideOrder, { orderId, decision: "confirm" }, staff);
    assert.equal(repeated.outcome, "already_confirmed");
    assert.equal((await db.collection("inventoryBalances").doc(balanceId).get()).data().quantityOnHand, 750);

    const confirmedTracking = await call(getGuestOrderTracking, { trackingToken });
    assert.equal(confirmedTracking.tracking.status, "confirmed");
    assert.equal(confirmedTracking.tracking.grandTotalMinor, 50000);
    assert.equal("customer" in confirmedTracking.tracking, false);
    assert.equal("fulfilment" in confirmedTracking.tracking, false);

    const recovery = await call(recoverGuestOrderTracking, { sessionToken, orderId });
    newTrackingToken = recovery.trackingToken;
    assert.equal(typeof newTrackingToken, "string");
    await assert.rejects(
      call(getGuestOrderTracking, { trackingToken }),
      error => error.code === "not-found"
    );
    const recoveredTracking = await call(getGuestOrderTracking, { trackingToken: newTrackingToken });
    assert.equal(recoveredTracking.tracking.status, "confirmed");

    const replay = await call(createGuestOrder, {
      sessionToken,
      order: {
        idempotencyKey: "grocery-" + suffix,
        items: [{ productId, variantId, sellingOptionId: optionId, quantity: 1 }],
        customer: { name: "Emulator Buyer", phone: "08000000000" },
        fulfilment: { method: "pickup" }
      }
    });
    assert.equal(replay.outcome, "replay");
    assert.equal(replay.orderId, orderId);
    assert.equal("trackingToken" in replay, false);

    const pendingOverstock = await call(createGuestOrder, {
      sessionToken,
      order: {
        idempotencyKey: "overstock-" + suffix,
        items: [{ productId, variantId, sellingOptionId: optionId, quantity: 4 }],
        customer: { name: "Emulator Buyer", phone: "08000000000" },
        fulfilment: { method: "pickup" }
      }
    });
    secondOrderId = pendingOverstock.orderId;
    secondTrackingToken = pendingOverstock.trackingToken;
    await assert.rejects(
      call(decideOrder, { orderId: secondOrderId, decision: "confirm" }, staff),
      error => error.code === "failed-precondition"
    );
    assert.equal((await db.collection("orders").doc(secondOrderId).get()).data().status, "awaiting_confirmation");
    assert.equal((await db.collection("inventoryBalances").doc(balanceId).get()).data().quantityOnHand, 750);
    assert.equal((await db.collection("inventoryMovements").where("orderId", "==", secondOrderId).get()).size, 0);

    const rejected = await call(decideOrder, { orderId: secondOrderId, decision: "reject" }, staff);
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.inventoryDeducted, false);
    assert.equal((await db.collection("inventoryBalances").doc(balanceId).get()).data().quantityOnHand, 750);
    const rejectedTracking = await call(getGuestOrderTracking, { trackingToken: secondTrackingToken });
    assert.equal(rejectedTracking.tracking.status, "rejected");
  } finally {
    const batch = db.batch();
    for (const id of [orderId, secondOrderId].filter(Boolean)) {
      batch.delete(db.collection("orders").doc(id));
      const [moves, orderAudits] = await Promise.all([
        db.collection("inventoryMovements").where("orderId", "==", id).get(),
        db.collection("auditLogs").where("entityId", "==", id).get()
      ]);
      for (const doc of [...moves.docs, ...orderAudits.docs]) batch.delete(doc.ref);
    }
    const setupAudits = await db.collection("auditLogs").where("productId", "==", productId).get();
    for (const doc of setupAudits.docs) batch.delete(doc.ref);
    if (secondOrderId) batch.delete(db.collection("orders").doc(secondOrderId));
    if (trackingToken) batch.delete(db.collection("orderTracking").doc(hashTrackingCredential(trackingToken)));
    if (secondTrackingToken) batch.delete(db.collection("orderTracking").doc(hashTrackingCredential(secondTrackingToken)));
    if (newTrackingToken) batch.delete(db.collection("orderTracking").doc(hashTrackingCredential(newTrackingToken)));
    if (sessionToken) {
      const sessionHash = hashGuestSessionCredential(sessionToken);
      batch.delete(db.collection("guestSessions").doc(sessionHash));
      batch.delete(db.collection("checkoutIdempotency").doc(buildIdempotencyRecord({
        scopeId: sessionHash,
        idempotencyKey: "grocery-" + suffix,
        payload: {
          idempotencyKey: "grocery-" + suffix,
          items: [{ productId, variantId, sellingOptionId: optionId, quantity: 1 }],
          customer: { name: "Emulator Buyer", phone: "08000000000" },
          fulfilment: { method: "pickup" },
          note: ""
        }
      }).keyHash));
      batch.delete(db.collection("checkoutIdempotency").doc(buildIdempotencyRecord({
        scopeId: sessionHash,
        idempotencyKey: "overstock-" + suffix,
        payload: {
          idempotencyKey: "overstock-" + suffix,
          items: [{ productId, variantId, sellingOptionId: optionId, quantity: 4 }],
          customer: { name: "Emulator Buyer", phone: "08000000000" },
          fulfilment: { method: "pickup" },
          note: ""
        }
      }).keyHash));
    }
    batch.delete(db.collection("inventoryMappings").doc(mappingId));
    batch.delete(db.collection("inventoryBalances").doc(balanceId));
    batch.delete(db.collection("inventoryForms").doc(formId));
    batch.delete(productRef);
    await batch.commit();
  }
});
