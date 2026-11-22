import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const shop = read("../structured-shop.html");
const adapter = read("../js/structured-commerce.mjs");
const backend = read("../functions/src/guest-order.mjs");
const validator = read("../functions/src/domain/checkout.mjs");
const docs = read("../docs/STRUCTURED-STOREFRONT-CHECKOUT-PREVIEW.md");

test("storefront order submission sends stable IDs and quantities, not client prices", () => {
  assert.match(shop, /cart\.map\(\(\{productId,variantId,sellingOptionId,quantity\}\)\s*=>\s*\(\{productId,variantId,sellingOptionId,quantity\}\)\)/);
  assert.doesNotMatch(shop, /items:\s*cart\.map\([^)]*(?:price|total|deliveryFee)/i);
  assert.match(adapter, /call\("createGuestOrder"\)/);
  assert.match(adapter, /sessionToken:\s*session\.sessionToken/);
  assert.match(backend, /calculateCheckoutQuote\(/);
  assert.match(backend, /grandTotalMinor:\s*quote\.grandTotalMinor/);
});

test("backend checkout contract rejects browser-supplied money and stock fields", () => {
  assert.match(validator, /allowedRoot\s*=\s*new Set\(\[\s*"idempotencyKey",\s*"items",\s*"customer",\s*"fulfilment",\s*"note"/);
  assert.match(validator, /const allowed = new Set\(\["productId", "variantId", "sellingOptionId", "quantity"\]\)/);
  assert.match(validator, /unexpected\.length/);
});

test("tracking credential is stored privately and preview stays development-only", () => {
  assert.match(adapter, /TRACKING_KEY\s*=\s*"tejuboss\.structuredTracking\.v1"/);
  assert.match(adapter, /writeJson\(localStorage, TRACKING_KEY, next\)/);
  assert.match(docs, /Status: Additive development preview committed and CI-tested/);
  assert.match(docs, /does not collect online payment/);
  assert.match(docs, /without explicit authorization/);
});
