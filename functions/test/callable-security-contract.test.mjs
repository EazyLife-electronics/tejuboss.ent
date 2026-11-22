import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
const catalogueSource = readFileSync(new URL("../src/catalogue-drafts.mjs", import.meta.url), "utf8");

function callableConfig(sourceText, name) {
  const pattern = new RegExp(`export const ${name} = onCall\\(\\s*\\{[^}]*\\}`);
  const match = sourceText.match(pattern);
  assert.ok(match, `${name} callable configuration should exist`);
  return match[0];
}

test("private quantity-pricing admin callables require Firebase App Check", () => {
  for (const name of ["publishQuantityPricing", "getQuantityPricingConfig"]) {
    assert.match(callableConfig(source, name), /enforceAppCheck:\s*true/, `${name} must enforce App Check`);
  }
});

test("catalogue administration callables require Firebase App Check", () => {
  for (const name of ["saveCatalogueDraft", "listCatalogueDrafts", "publishCatalogueDraft"]) {
    assert.match(callableConfig(catalogueSource, name), /enforceAppCheck:\s*true/, `${name} must enforce App Check`);
  }
});

test("public backend status endpoint intentionally remains callable without App Check", () => {
  assert.match(callableConfig(source, "backendStatus"), /enforceAppCheck:\s*false/);
});
