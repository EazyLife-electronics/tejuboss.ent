import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicQuantityTierProjection } from "../src/domain/public-quantity-pricing.mjs";

const privateRule = {
  id: "piece-bulk",
  enabled: true,
  qualificationBasis: "selected_option_quantity",
  aggregateAcrossOptions: false,
  eligibleSellingOptionIds: ["piece"],
  pricingMode: "threshold",
  effectiveFromMillis: 1000,
  effectiveUntilMillis: 5000,
  internalCostMinor: 65000,
  targetMarginPercent: 25,
  supplierName: "Private Supplier",
  internalNotes: "Never publish",
  tiers: [{
    id: "five-plus",
    minimumQuantity: 5,
    priceBySellingOptionId: { piece: 90000 },
    costFloorMinor: 70000
  }]
};

test("publishes customer-safe fields and excludes private commercial data", () => {
  const projection = buildPublicQuantityTierProjection({
    productId: "lamp",
    variantId: "white",
    rule: privateRule,
    configVersion: "v7",
    nowMillis: 2000
  });

  assert.equal(projection.enabled, true);
  assert.equal(projection.publicationState, "published");
  assert.equal(projection.tiers[0].priceBySellingOptionId.piece, 90000);
  assert.deepEqual(Object.keys(projection).sort(), [
    "aggregateAcrossOptions", "configVersion", "currency", "effectiveFromMillis",
    "effectiveUntilMillis", "eligibleSellingOptionIds", "enabled", "pricingMode",
    "productId", "publicPricingId", "publicationState", "qualificationBasis",
    "ruleId", "schemaVersion", "tiers", "updatedAtMillis", "variantId"
  ].sort());
  assert.equal(JSON.stringify(projection).includes("internalCostMinor"), false);
  assert.equal(JSON.stringify(projection).includes("targetMarginPercent"), false);
  assert.equal(JSON.stringify(projection).includes("Private Supplier"), false);
  assert.equal(JSON.stringify(projection).includes("costFloorMinor"), false);
});

test("future offers are published as scheduled but not active", () => {
  const projection = buildPublicQuantityTierProjection({
    productId: "lamp",
    variantId: "white",
    rule: privateRule,
    configVersion: "v7",
    nowMillis: 500
  });
  assert.equal(projection.publicationState, "scheduled");
  assert.equal(projection.enabled, false);
});

test("expired offers are not active", () => {
  const projection = buildPublicQuantityTierProjection({
    productId: "lamp",
    variantId: "white",
    rule: privateRule,
    configVersion: "v7",
    nowMillis: 5000
  });
  assert.equal(projection.publicationState, "expired");
  assert.equal(projection.enabled, false);
});

test("disabled rules cannot appear as active public offers", () => {
  const projection = buildPublicQuantityTierProjection({
    productId: "lamp",
    variantId: "white",
    rule: { ...privateRule, enabled: false },
    configVersion: "v7",
    nowMillis: 2000
  });
  assert.equal(projection.publicationState, "disabled");
  assert.equal(projection.enabled, false);
});

test("rejects malformed rules and invalid effective date windows", () => {
  assert.throws(() => buildPublicQuantityTierProjection({
    productId: "lamp", variantId: "white",
    rule: { ...privateRule, effectiveUntilMillis: 900 },
    configVersion: "v7", nowMillis: 2000
  }));
  assert.throws(() => buildPublicQuantityTierProjection({
    productId: "lamp", variantId: "white",
    rule: { ...privateRule, tiers: [] },
    configVersion: "v7", nowMillis: 2000
  }), error => error.code === "INVALID_TIER_CONFIGURATION");
});
