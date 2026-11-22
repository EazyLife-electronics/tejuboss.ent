import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../src/index.mjs");

function callableConfig(sourceText, name) {
  const declaration = `export const ${name}`;
  const start = sourceText.indexOf(declaration);
  assert.notEqual(start, -1, `${name} callable declaration should exist`);
  const call = sourceText.indexOf("onCall(", start);
  assert.ok(call >= start && call - start < 160, `${name} should be exported as a callable`);
  return sourceText.slice(call, call + 300);
}

test("all guest-facing callable endpoints require Firebase App Check", () => {
  const endpoints = [
    ["../src/guest-checkout-session.mjs", "createGuestCheckoutSession"],
    ["../src/guest-order.mjs", "createGuestOrder"],
    ["../src/order-tracking.mjs", "getGuestOrderTracking"],
    ["../src/order-tracking.mjs", "recoverGuestOrderTracking"],
    ["../src/legacy-order-tracking.mjs", "getLegacyOrderTracking"],
    ["../src/delivery-public.mjs", "getPublicDeliveryOptions"]
  ];
  for (const [path, name] of endpoints) {
    assert.match(callableConfig(read(path), name), /enforceAppCheck:\s*true/, `${name} must enforce App Check`);
  }
});

test("all privileged commerce callables require App Check and backend authorization", () => {
  const endpoints = [
    ["../src/index.mjs", "publishQuantityPricing"],
    ["../src/index.mjs", "getQuantityPricingConfig"],
    ["../src/catalogue-drafts.mjs", "saveCatalogueDraft"],
    ["../src/catalogue-drafts.mjs", "listCatalogueDrafts"],
    ["../src/catalogue-drafts.mjs", "publishCatalogueDraft"],
    ["../src/inventory-setup.mjs", "initializeInventoryBalance"],
    ["../src/inventory-mapping.mjs", "saveInventoryMapping"],
    ["../src/inventory-overview.mjs", "listInventorySetup"],
    ["../src/inventory-adjustment.mjs", "adjustInventoryPhysicalCount"],
    ["../src/delivery-policy-admin.mjs", "getDeliveryPolicy"],
    ["../src/delivery-policy-admin.mjs", "saveDeliveryPolicy"],
    ["../src/order-queue.mjs", "listPendingCommerceOrders"],
    ["../src/order-confirmation.mjs", "decideOrder"],
    ["../src/order-fulfilment.mjs", "updateOrderFulfilment"],
    ["../src/order-payment.mjs", "recordOrderPayment"],
    ["../src/order-payment.mjs", "listOrderPaymentHistory"],
    ["../src/order-archive.mjs", "listCommerceOrderArchive"]
  ];
  for (const [path, name] of endpoints) {
    const moduleSource = read(path);
    const config = callableConfig(moduleSource, name);
    assert.match(config, /enforceAppCheck:\s*true/, `${name} must enforce App Check`);
    assert.match(moduleSource, /request\.auth/, `${name} must inspect Firebase Authentication`);
    assert.match(moduleSource, /permission-denied/, `${name} must reject unauthorized roles`);
  }
});

test("public backend status endpoint intentionally remains callable without App Check", () => {
  assert.match(callableConfig(source, "backendStatus"), /enforceAppCheck:\s*false/);
});


test("guest session and idempotency records carry Firestore TTL timestamps", () => {
  const sessions = read("../src/guest-checkout-session.mjs");
  const orders = read("../src/guest-order.mjs");
  assert.match(sessions, /expiresAt:\s*Timestamp\.fromMillis\(credential\.expiresAtMillis\)/);
  assert.match(orders, /expiresAt:\s*Timestamp\.fromMillis\(now\s*\+\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\)/);
});


test("legacy tracking callable verifies phone suffix and returns a minimized projection", () => {
  const legacy = read("../src/legacy-order-tracking.mjs");
  assert.match(callableConfig(legacy, "getLegacyOrderTracking"), /enforceAppCheck:\s*true/);
  assert.match(legacy, /phoneLast4/);
  assert.match(legacy, /storedPhone\.slice\(-4\) !== phoneLast4/);
  assert.match(legacy, /order\.source === "guest"/);
  assert.match(legacy, /tracking:\s*\{/);
  assert.doesNotMatch(legacy, /return\s*\{\s*success:\s*true,\s*order\s*:/);
  assert.doesNotMatch(legacy, /phone:\s*storedPhone/);
});

test("legacy tracking page does not read private Firestore order or delivery documents", () => {
  const trackingPage = read("../../track.html");
  assert.match(trackingPage, /getLegacyOrderTracking/);
  assert.equal(trackingPage.includes("getOrderByTrackingCode"), false);
  assert.equal(trackingPage.includes("getDelivery("), false);
});

test("purchase receiving, voiding and history are protected trusted callables", () => {
  const purchases = read("../src/purchase-operations.mjs");
  for (const name of ["receiveLegacyPurchase", "voidLegacyPurchase", "listLegacyPurchases", "adjustLegacyVariantStock"]) {
    assert.ok(callableConfig(purchases, name).includes("enforceAppCheck: true"), name + " must require App Check");
  }
  assert.ok(purchases.includes("inventory_manager"));
  assert.ok(purchases.includes("tx.create(movementRef"));
  assert.ok(purchases.includes("tx.create(auditRef"));
  assert.ok(purchases.includes("tx.update(productRef"));
  assert.ok(purchases.includes('status: "voided"'));
});

test("legacy purchase browser modules no longer mutate stock through client transactions", () => {
  const receiving = read("../../admin/js/purchases.mjs");
  const voiding = read("../../admin/js/purchase-void.mjs");
  assert.ok(receiving.includes("receiveLegacyPurchase"));
  assert.ok(receiving.includes("listLegacyPurchases"));
  assert.ok(voiding.includes("voidLegacyPurchase"));
  assert.equal(receiving.includes("runTransaction"), false);
  assert.equal(voiding.includes("runTransaction"), false);
});

test("manual legacy stock adjustments are server-authoritative and reasoned", () => {
  const purchases = read("../src/purchase-operations.mjs");
  const inventory = read("../../admin/js/inventory.mjs");
  assert.ok(purchases.includes("expectedQuantity"));
  assert.ok(purchases.includes("A reason is required for every manual stock adjustment."));
  assert.ok(inventory.includes("adjustLegacyVariantStock"));
  const changeStock = inventory.slice(inventory.indexOf("async function changeStock("), inventory.indexOf("async function saveVariantSettings"));
  assert.equal(changeStock.includes("runTransaction"), false);
  assert.ok(inventory.includes("runTransaction"), "metadata-only settings retain their current-value-preserving transaction");
});

test("supplier master and legacy inventory metadata use trusted callable operations", () => {
  const operations = read("../src/purchase-operations.mjs");
  for (const name of ["listLegacySuppliers", "saveLegacySupplier", "syncLegacyPurchaseSupplierLinks", "updateLegacyVariantMetadata"]) {
    assert.ok(callableConfig(operations, name).includes("enforceAppCheck: true"), name + " must require App Check");
  }
  assert.ok(operations.includes("normalizedName"));
  assert.ok(operations.includes("supplier_created"));
  assert.ok(operations.includes("legacy_variant_metadata_updated"));
  const suppliers = read("../../admin/js/suppliers.mjs");
  const inventory = read("../../admin/js/inventory.mjs");
  assert.ok(suppliers.includes("listLegacySuppliers"));
  assert.ok(suppliers.includes("saveLegacySupplier"));
  assert.ok(suppliers.includes("syncLegacyPurchaseSupplierLinks"));
  assert.equal(suppliers.includes("getDocs(collection(db"), false);
  assert.equal(suppliers.includes("addDoc(collection(db"), false);
  assert.equal(suppliers.includes("updateDoc(doc(db"), false);
  assert.ok(inventory.includes("updateLegacyVariantMetadata"));
  assert.equal(inventory.includes("tx.update(productRef"), false);
});

test("purchase receiving retains the same idempotency key across uncertain retries", () => {
  const receiving = read("../../admin/js/purchases.mjs");
  assert.ok(receiving.includes("tejuboss.pendingPurchaseSubmission"));
  assert.ok(receiving.includes("pendingPurchaseSubmission.key"));
  assert.ok(receiving.includes("JSON.stringify(pendingPurchaseSubmission.payload) !== JSON.stringify(payload)"));
  assert.ok(receiving.includes("localStorage.removeItem('tejuboss.pendingPurchaseSubmission')"));
});

test("legacy delivery configuration and lifecycle mutations use trusted callables", () => {
  const delivery = read("../src/delivery-operations-admin.mjs");
  for (const name of ["manageLegacyDeliveryConfig", "createLegacyDelivery", "updateLegacyDelivery"]) {
    assert.ok(callableConfig(delivery, name).includes("enforceAppCheck:true"), name + " must require App Check");
  }
  assert.ok(delivery.includes("delivery_manager"));
  assert.ok(delivery.includes("delivery_config_created"));
  assert.ok(delivery.includes("delivery_updated"));
  assert.ok(delivery.includes("A previous delivery for this order was closed"));
  const store = read("../../admin/js/delivery-store.mjs");
  assert.ok(store.includes("manageLegacyDeliveryConfig"));
  assert.ok(store.includes("createLegacyDelivery"));
  assert.ok(store.includes("updateLegacyDelivery"));
  for (const directWrite of ["addDoc(", "updateDoc(", "deleteDoc(", "setDoc("]) {
    assert.equal(store.includes(directWrite), false, "delivery store must not use " + directWrite);
  }
});

test("delivery queue uses a minimized App Check protected order projection", () => {
  const delivery = read("../src/delivery-operations-admin.mjs");
  assert.ok(callableConfig(delivery, "listLegacyDeliveryOrders").includes("enforceAppCheck:true"));
  assert.ok(delivery.includes('where("status","in",["confirmed","shipped"])'));
  assert.ok(delivery.includes("customerName:d.customerName"));
  const store = read("../../admin/js/delivery-store.mjs");
  const ui = read("../../admin/js/delivery.mjs");
  assert.ok(store.includes("listLegacyDeliveryOrders"));
  assert.ok(store.includes("setInterval(refresh, 60000)"));
  assert.ok(ui.includes("watchDeliveryOrders"));
  assert.equal(ui.includes("watchOrders"), false);
});
