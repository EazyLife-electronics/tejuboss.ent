import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");

function callableBlock(name) {
  const start = source.indexOf(`export const ${name} = onCall(`);
  assert.notEqual(start, -1, `${name} callable should exist`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("private quantity-pricing admin callables require Firebase App Check", () => {
  for (const name of ["publishQuantityPricing", "getQuantityPricingConfig"]) {
    assert.match(callableBlock(name), /enforceAppCheck:\\s*true/, `${name} must enforce App Check`);
  }
});

test("public backend status endpoint remains data-minimal and does not require staff App Check", () => {
  const block = callableBlock("backendStatus");
  assert.match(block, /enforceAppCheck:\\s*false/);
  assert.match(block, /service:\\s*"tejuboss/);
  assert.doesNotMatch(block, /customer|inventory|pricingConfigs|orders/);
});
