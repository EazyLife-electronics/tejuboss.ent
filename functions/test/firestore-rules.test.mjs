import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc
} from "firebase/firestore";

const projectId = "tejuboss-rules-test";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL("../../firestore.next.rules", import.meta.url), "utf8")
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
    await setDoc(doc(db, "products", "published"), {
      name: "Published item",
      published: true
    });
    await setDoc(doc(db, "products", "draft"), {
      name: "Draft item",
      published: false
    });
    await setDoc(doc(db, "publicPricing", "offer"), {
      enabled: true,
      tiers: [{ minimumQuantity: 2, priceMinor: 90000 }]
    });
    await setDoc(doc(db, "catalogueProducts", "structured-published"), { name: "Structured item", published: true });
    await setDoc(doc(db, "catalogueProducts", "structured-draft"), { name: "Structured draft", published: false });
    await setDoc(doc(db, "catalogueDrafts", "private-draft"), { draft: { name: "Private draft" } });
    await setDoc(doc(db, "pricingConfigs", "private"), {
      costPriceMinor: 50000,
      marginTarget: 20
    });
    await setDoc(doc(db, "inventoryBalances", "sample-balance"), { quantityOnHand: 50 });
    await setDoc(doc(db, "deliveryPersonnel", "rider-1"), { name: "Test Rider", phone: "08000000000", active: true });
    await setDoc(doc(db, "deliveryTypes", "home"), { name: "Home Delivery", active: true });
    await setDoc(doc(db, "deliveryCheckpoints", "hub"), { name: "Main Hub", active: true });
    await setDoc(doc(db, "orders", "order-1"), {
      customerName: "Private customer",
      phone: "08000000000",
      total: 100000
    });
    await setDoc(doc(db, "orders", "order-1", "payments", "receipt-1"), { amountMinor: 1000 });
    await setDoc(doc(db, "orderTracking", "unguessable-token"), {
      status: "processing",
      customerSafeMessage: "Your order is being prepared"
    });
  });
});

test("visitors can read published products and public quantity offers", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "products", "published")));
  await assertFails(getDoc(doc(db, "products", "draft")));
  await assertSucceeds(getDoc(doc(db, "publicPricing", "offer")));
  await assertSucceeds(getDoc(doc(db, "catalogueProducts", "structured-published")));
  await assertFails(getDoc(doc(db, "catalogueProducts", "structured-draft")));
  await assertFails(getDoc(doc(db, "catalogueDrafts", "private-draft")));
});

test("inventory staff can inspect unpublished legacy products without granting public draft reads", async () => {
  const staffDb = env.authenticatedContext("stock-uid", { role: "inventory_manager" }).firestore();
  const visitorDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(staffDb, "products", "draft")));
  await assertFails(getDoc(doc(visitorDb, "products", "draft")));
});

test("visitors cannot read private prices or full orders", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "pricingConfigs", "private")));
  await assertFails(getDoc(doc(db, "orders", "order-1")));
  await assertFails(getDocs(collection(db, "orders")));
});

test("visitors cannot create or modify orders directly", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, "orders", "forged"), {
    total: 1,
    items: []
  }));
  await assertFails(updateDoc(doc(db, "orders", "order-1"), {
    total: 1
  }));
});

test("tracking token permits one projection read but not enumeration or writes", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "orderTracking", "unguessable-token")));
  await assertFails(getDocs(collection(db, "orderTracking")));
  await assertFails(setDoc(doc(db, "orderTracking", "forged"), {
    status: "delivered"
  }));
});

test("owner can read private orders but private pricing remains backend-only", async () => {
  const db = env.authenticatedContext("owner-uid", { role: "owner" }).firestore();
  await assertSucceeds(getDoc(doc(db, "orders", "order-1")));
  await assertFails(getDoc(doc(db, "pricingConfigs", "private")));
});

test("unrelated signed-in customer cannot read another customer's order", async () => {
  const db = env.authenticatedContext("customer-uid", { role: "customer" }).firestore();
  await assertFails(getDoc(doc(db, "orders", "order-1")));
});

test("catalogue drafts and structured catalogue are not client-writable", async () => {
  const db = env.authenticatedContext("owner-uid", { role: "owner" }).firestore();
  await assertFails(setDoc(doc(db, "catalogueDrafts", "forged"), { draft: {} }));
  await assertFails(setDoc(doc(db, "catalogueProducts", "forged"), { published: true }));
});

test("inventory staff can inspect balances but cannot bypass movement transactions", async () => {
  const staffDb = env.authenticatedContext("stock-uid", { role: "inventory_manager" }).firestore();
  await assertSucceeds(getDoc(doc(staffDb, "inventoryBalances", "sample-balance")));
  await assertFails(updateDoc(doc(staffDb, "inventoryBalances", "sample-balance"), { quantityOnHand: 0 }));
  await assertFails(setDoc(doc(staffDb, "inventoryMovements", "forged"), { movementType: "sale" }));
});

test("delivery managers can read delivery reference data but cannot write it", async () => {
  const deliveryDb = env.authenticatedContext("delivery-uid", { role: "delivery_manager" }).firestore();
  const orderDb = env.authenticatedContext("order-uid", { role: "order_manager" }).firestore();
  const ownerDb = env.authenticatedContext("owner-uid", { role: "owner" }).firestore();
  await assertSucceeds(getDoc(doc(deliveryDb, "deliveryPersonnel", "rider-1")));
  await assertSucceeds(getDoc(doc(deliveryDb, "deliveryTypes", "home")));
  await assertSucceeds(getDoc(doc(deliveryDb, "deliveryCheckpoints", "hub")));
  await assertFails(setDoc(doc(deliveryDb, "deliveryPersonnel", "forged"), { name: "Forged" }));
  await assertFails(updateDoc(doc(deliveryDb, "deliveryTypes", "home"), { active: false }));
  await assertFails(getDoc(doc(orderDb, "deliveryPersonnel", "rider-1")));
  await assertSucceeds(getDoc(doc(ownerDb, "deliveryPersonnel", "rider-1")));
});

test("only owner and payment staff can read payment receipt records", async () => {
  const paymentRef = ["orders", "order-1", "payments", "receipt-1"];
  const ownerDb = env.authenticatedContext("owner-uid", { role: "owner" }).firestore();
  const paymentDb = env.authenticatedContext("payment-uid", { role: "payment_manager" }).firestore();
  const orderDb = env.authenticatedContext("order-uid", { role: "order_manager" }).firestore();
  await assertSucceeds(getDoc(doc(ownerDb, ...paymentRef)));
  await assertSucceeds(getDoc(doc(paymentDb, ...paymentRef)));
  await assertFails(getDoc(doc(orderDb, ...paymentRef)));
});


test("unmigrated legacy admin collections remain closed in the hardened candidate", async () => {
  const visitor = env.unauthenticatedContext().firestore();
  const owner = env.authenticatedContext("owner-uid", { role: "owner" }).firestore();

  // These legacy UI workflows still use direct Firestore operations. They
  // must not become public merely to preserve compatibility during migration.
  for (const collectionName of [
    "heroes", "reviews", "requests", "settings", "purchases", "suppliers"
  ]) {
    await assertFails(getDoc(doc(visitor, collectionName, "sample")));
    await assertFails(setDoc(doc(visitor, collectionName, "forged"), { value: true }));
    // Owner access is also intentionally not granted until the collection's
    // field model and least-privilege role are explicitly added to the rules.
    await assertFails(getDoc(doc(owner, collectionName, "sample")));
  }
});
