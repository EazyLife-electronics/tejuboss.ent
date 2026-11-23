import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch, runTransaction
} from "firebase/firestore";

const projectId = "tejuboss-commerce-rules-test";
const adminClaims = { email: "damzyeazy@gmail.com", email_verified: true };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8")
    }
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "catalogueProducts", "published-item"), {
      name: "Rice", published: true, sellingOptions: [{ id: "bag-5kg", priceMinor: 125000 }]
    });
    await setDoc(doc(db, "catalogueProducts", "draft-item"), {
      name: "Draft rice", published: false, sellingOptions: []
    });
    await setDoc(doc(db, "categories", "groceries"), { name: "Groceries", active: true });
    await setDoc(doc(db, "categories", "hidden"), { name: "Hidden", active: false });
    await setDoc(doc(db, "siteSettings", "public"), { whatsapp: "2347079557886", tagline: "Everyday essentials" });
    await setDoc(doc(db, "siteSettings", "private"), { supplierMargin: 15 });
    await setDoc(doc(db, "inventoryBalances", "rice__bag__main"), {
      productId: "published-item", sellingOptionId: "bag-5kg", locationId: "main",
      quantityOnHand: 12, reorderLevel: 3
    });
    await setDoc(doc(db, "inventoryMovements", "opening"), {
      productId: "published-item", quantityDelta: 12, movementType: "opening_balance"
    });
    await setDoc(doc(db, "orders", "existing-private-order"), {
      schemaVersion: 1, orderId: "existing-private-order", trackingToken: "a".repeat(32),
      status: "awaiting_review", quoteStatus: "unverified"
    });
    await setDoc(doc(db, "orderTracking", "a".repeat(32)), {
      orderId: "existing-private-order", status: "submitted",
      createdAt: new Date(), updatedAt: new Date()
    });
  });
});

function validOrder(orderId, token = "b".repeat(32)) {
  return {
    schemaVersion: 1,
    orderId,
    trackingToken: token,
    status: "awaiting_review",
    customer: { name: "Test Customer", phone: "08012345678", email: null },
    fulfilment: { method: "delivery", address: "Ibadan", city: "Ibadan", state: "Oyo", note: "" },
    lines: [{
      productId: "published-item", sellingOptionId: "bag-5kg",
      requestedName: "Rice", requestedOption: "5kg bag", quantity: 2,
      displayedUnitPriceMinor: 125000
    }],
    quote: { currency: "NGN", subtotalMinor: 250000, deliveryFeeMinor: 0, grandTotalMinor: 250000 },
    quoteStatus: "unverified",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

test("public visitors can read only published catalogue and active categories", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "catalogueProducts", "published-item")));
  await assertFails(getDoc(doc(db, "catalogueProducts", "draft-item")));
  await assertSucceeds(getDoc(doc(db, "categories", "groceries")));
  await assertFails(getDoc(doc(db, "categories", "hidden")));
  await assertSucceeds(getDoc(doc(db, "siteSettings", "public")));
  await assertFails(getDoc(doc(db, "siteSettings", "private")));
});

test("guest can atomically create a valid order request and its minimal tracking projection", async () => {
  const db = env.unauthenticatedContext().firestore();
  const orderId = "guest-order-0000000001";
  const token = "c".repeat(32);
  const batch = writeBatch(db);
  batch.set(doc(db, "orders", orderId), validOrder(orderId, token));
  batch.set(doc(db, "orderTracking", token), {
    orderId, status: "submitted", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db, "orderTracking", token)));
  await assertFails(getDoc(doc(db, "orders", orderId)));
});

test("guest order validation rejects forged status, extra private fields and malformed values", async () => {
  const db = env.unauthenticatedContext().firestore();
  const base = validOrder("guest-order-0000000002", "d".repeat(32));
  await assertFails(setDoc(doc(db, "orders", base.orderId), { ...base, status: "approved" }));
  await assertFails(setDoc(doc(db, "orders", "guest-order-0000000003"), {
    ...validOrder("guest-order-0000000003", "e".repeat(32)), internalNote: "Injected"
  }));
  await assertFails(setDoc(doc(db, "orders", "guest-order-0000000004"), {
    ...validOrder("guest-order-0000000004", "f".repeat(32)),
    quote: { currency: "NGN", subtotalMinor: -1, deliveryFeeMinor: 0, grandTotalMinor: -1 }
  }));
  await assertFails(setDoc(doc(db, "orders", "guest-order-0000000005"), {
    ...validOrder("guest-order-0000000005", "1".repeat(32)),
    customer: { name: "", phone: "1" }
  }));
});

test("guests cannot read, enumerate, update or delete private orders", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "orders", "existing-private-order")));
  await assertFails(getDocs(collection(db, "orders")));
  await assertFails(updateDoc(doc(db, "orders", "existing-private-order"), { status: "approved" }));
  await assertFails(deleteDoc(doc(db, "orders", "existing-private-order")));
});

test("tracking permits exact-token get only and rejects enumeration or guest writes", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "orderTracking", "a".repeat(32))));
  await assertFails(getDocs(collection(db, "orderTracking")));
  await assertFails(updateDoc(doc(db, "orderTracking", "a".repeat(32)), { status: "approved" }));
  await assertFails(deleteDoc(doc(db, "orderTracking", "a".repeat(32))));
  await assertFails(setDoc(doc(db, "orderTracking", "2".repeat(32)), {
    orderId: "forged-order-00000001", status: "submitted",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), customerPhone: "08000000000"
  }));
});

test("only configured administrator can manage catalogue, orders and settings", async () => {
  const admin = env.authenticatedContext("admin-uid", adminClaims).firestore();
  const other = env.authenticatedContext("other-uid", { email: "someone@example.com", email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(admin, "catalogueProducts", "draft-item")));
  await assertFails(getDoc(doc(other, "catalogueProducts", "draft-item")));
  await assertFails(getDoc(doc(other, "orders", "existing-private-order")));
  await assertFails(updateDoc(doc(other, "catalogueProducts", "published-item"), { published: false }));
  await assertSucceeds(updateDoc(doc(admin, "catalogueProducts", "draft-item"), { published: true }));
  await assertSucceeds(getDoc(doc(admin, "orders", "existing-private-order")));
  await assertSucceeds(updateDoc(doc(admin, "orders", "existing-private-order"), { status: "approved" }));
  await assertSucceeds(setDoc(doc(admin, "siteSettings", "public"), { tagline: "Updated" }, { merge: true }));
});

test("inventory is administrator-only and movement history is immutable", async () => {
  const admin = env.authenticatedContext("admin-uid", adminClaims).firestore();
  const visitor = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(admin, "inventoryBalances", "rice__bag__main")));
  await assertSucceeds(updateDoc(doc(admin, "inventoryBalances", "rice__bag__main"), { quantityOnHand: 11 }));
  await assertSucceeds(getDoc(doc(admin, "inventoryMovements", "opening")));
  await assertFails(updateDoc(doc(admin, "inventoryMovements", "opening"), { quantityDelta: 99 }));
  await assertFails(deleteDoc(doc(admin, "inventoryMovements", "opening")));
  await assertFails(getDoc(doc(visitor, "inventoryBalances", "rice__bag__main")));
  await assertFails(getDoc(doc(visitor, "inventoryMovements", "opening")));
});

test("administrator order review updates private order and public tracking atomically", async () => {
  const db = env.authenticatedContext("admin-uid", adminClaims).firestore();
  const orderRef = doc(db, "orders", "existing-private-order");
  const trackingRef = doc(db, "orderTracking", "a".repeat(32));
  await runTransaction(db, async tx => {
    const order = await tx.get(orderRef);
    const tracking = await tx.get(trackingRef);
    assert.equal(order.data().status, "awaiting_review");
    assert.equal(tracking.data().status, "submitted");
    tx.update(orderRef, { status: "approved", quoteStatus: "staff_verified" });
    tx.update(trackingRef, { status: "approved" });
  });
  assert.equal((await getDoc(orderRef)).data().status, "approved");
  assert.equal((await getDoc(trackingRef)).data().status, "approved");
});

test("administrator inventory movement writes balance and immutable ledger together", async () => {
  const db = env.authenticatedContext("admin-uid", adminClaims).firestore();
  const balanceRef = doc(db, "inventoryBalances", "rice__bag__main");
  const movementRef = doc(collection(db, "inventoryMovements"));
  await runTransaction(db, async tx => {
    const balance = await tx.get(balanceRef);
    const next = balance.data().quantityOnHand - 2;
    assert.ok(next >= 0);
    tx.update(balanceRef, { quantityOnHand: next });
    tx.set(movementRef, {
      productId: "published-item", sellingOptionId: "bag-5kg", locationId: "main",
      quantityDelta: -2, movementType: "issue", reason: "Test issue"
    });
  });
  assert.equal((await getDoc(balanceRef)).data().quantityOnHand, 10);
  assert.equal((await getDoc(movementRef)).data().quantityDelta, -2);
  await assertFails(updateDoc(movementRef, { quantityDelta: 500 }));
});

test("unlisted legacy collections remain closed by default", async () => {
  const admin = env.authenticatedContext("admin-uid", adminClaims).firestore();
  const visitor = env.unauthenticatedContext().firestore();
  for (const name of ["products", "heroes", "reviews", "requests", "settings", "legacyOrders"]) {
    await assertFails(getDoc(doc(visitor, name, "sample")));
    await assertFails(getDoc(doc(admin, name, "sample")));
    await assertFails(setDoc(doc(admin, name, "new"), { value: true }));
  }
});
