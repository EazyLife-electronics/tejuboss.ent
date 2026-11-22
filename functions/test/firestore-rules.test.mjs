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
    await setDoc(doc(db, "orders", "order-1"), {
      customerName: "Private customer",
      phone: "08000000000",
      total: 100000
    });
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
