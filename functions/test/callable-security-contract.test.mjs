import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../src/index.mjs");

function callableConfig(sourceText, name) {
  const pattern = new RegExp(`export const ${name} = onCall\\(\\s*\\{[^}]*\\}`);
  const match = sourceText.match(pattern);
  assert.ok(match, `${name} callable configuration should exist`);
  return match[0];
}

test("all guest-facing callable endpoints require Firebase App Check", () => {
  const endpoints = [
    ["../src/guest-checkout-session.mjs", "createGuestCheckoutSession"],
    ["../src/guest-order.mjs", "createGuestOrder"],
    ["../src/order-tracking.mjs", "getGuestOrderTracking"],
    ["../src/order-tracking.mjs", "recoverGuestOrderTracking"],
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
