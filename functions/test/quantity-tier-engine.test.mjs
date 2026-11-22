import test from "node:test";
import assert from "node:assert/strict";
import {
  validateQuantityTierRule,
  calculateQuantityTierPrice,
  deriveTierQualificationQuantity
} from "../src/domain/quantity-tier-engine.mjs";

const thresholdRule = {
  enabled: true,
  qualificationBasis: "selected_option_quantity",
  aggregateAcrossOptions: false,
  eligibleSellingOptionIds: ["piece"],
  pricingMode: "threshold",
  tiers: [
    { id: "bulk-5", minimumQuantity: 5, maximumQuantity: 9, priceBySellingOptionId: { piece: 90000 } },
    { id: "bulk-10", minimumQuantity: 10, priceBySellingOptionId: { piece: 80000 } }
  ]
};

const marginalRule = {
  enabled: true,
  qualificationBasis: "selected_option_quantity",
  aggregateAcrossOptions: false,
  eligibleSellingOptionIds: ["piece"],
  pricingMode: "marginal",
  tiers: [
    { id: "standard", minimumQuantity: 1, maximumQuantity: 4, priceBySellingOptionId: { piece: 100000 } },
    { id: "bulk-5", minimumQuantity: 5, maximumQuantity: 9, priceBySellingOptionId: { piece: 90000 } },
    { id: "bulk-10", minimumQuantity: 10, priceBySellingOptionId: { piece: 80000 } }
  ]
};

test("threshold mode applies the reached rate to all eligible quantity", () => {
  const result = calculateQuantityTierPrice({
    rule: thresholdRule,
    quantity: 10,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "piece"
  });
  assert.equal(result.totalMinor, 800000);
  assert.equal(result.baseTotalMinor, 1000000);
  assert.equal(result.discountMinor, 200000);
  assert.equal(result.tierId, "bulk-10");
  assert.equal(result.pricingMode, "threshold");
});

test("threshold mode leaves quantity at base price before first threshold", () => {
  const result = calculateQuantityTierPrice({
    rule: thresholdRule,
    quantity: 4,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "piece"
  });
  assert.equal(result.applied, false);
  assert.equal(result.totalMinor, 400000);
  assert.equal(result.reason, "threshold_not_reached");
});

test("marginal mode prices each quantity band at its own rate", () => {
  const result = calculateQuantityTierPrice({
    rule: marginalRule,
    quantity: 12,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "piece"
  });
  // 4 x 1,000 + 5 x 900 + 3 x 800 = 10,900
  assert.equal(result.totalMinor, 1090000);
  assert.equal(result.baseTotalMinor, 1200000);
  assert.equal(result.discountMinor, 110000);
  assert.deepEqual(result.appliedTierIds, ["standard", "bulk-5", "bulk-10"]);
});

test("base-stock qualification supports an explicit cross-option-equivalent rate", () => {
  const rule = {
    enabled: true,
    qualificationBasis: "base_stock_quantity",
    aggregateAcrossOptions: true,
    eligibleSellingOptionIds: ["piece", "pack"],
    pricingMode: "threshold",
    tiers: [{
      id: "equivalent-12",
      minimumQuantity: 12,
      pricePerBaseUnitMinor: 85000
    }]
  };
  assert.equal(validateQuantityTierRule(rule).valid, true);
  const result = calculateQuantityTierPrice({
    rule,
    quantity: 12,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "piece"
  });
  assert.equal(result.totalMinor, 1020000);
  assert.equal(result.discountMinor, 180000);
  assert.equal(result.qualificationBasis, "base_stock_quantity");
});

test("does not apply a rule to an ineligible selling option", () => {
  const result = calculateQuantityTierPrice({
    rule: thresholdRule,
    quantity: 10,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "carton"
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "selling_option_not_eligible");
});

test("disabled rule never applies a tier", () => {
  const result = calculateQuantityTierPrice({
    rule: { ...thresholdRule, enabled: false },
    quantity: 20,
    baseUnitPriceMinor: 100000,
    sellingOptionId: "piece"
  });
  assert.equal(result.applied, false);
  assert.equal(result.discountMinor, 0);
});

test("rejects a tier price higher than the normal price", () => {
  const rule = {
    ...thresholdRule,
    tiers: [{ id: "bad", minimumQuantity: 2, priceBySellingOptionId: { piece: 110000 } }]
  };
  assert.throws(() => calculateQuantityTierPrice({
    rule, quantity: 2, baseUnitPriceMinor: 100000, sellingOptionId: "piece"
  }), error => error.code === "TIER_PRICE_INCREASE");
});

test("rejects gaps in marginal bands", () => {
  const invalidRule = {
    ...marginalRule,
    tiers: [
      { id: "first", minimumQuantity: 1, maximumQuantity: 4, priceBySellingOptionId: { piece: 100000 } },
      { id: "second", minimumQuantity: 6, priceBySellingOptionId: { piece: 90000 } }
    ]
  };
  const validation = validateQuantityTierRule(invalidRule);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(issue => issue.includes("contiguous")));
});

test("requires explicit tier price for the eligible selling option", () => {
  const invalidRule = {
    ...thresholdRule,
    tiers: [{ id: "bulk", minimumQuantity: 5, priceBySellingOptionId: {} }]
  };
  assert.equal(validateQuantityTierRule(invalidRule).valid, false);
});


test("derives base-stock quantity from explicit pack conversion", () => {
  const rule = {
    enabled: true,
    qualificationBasis: "base_stock_quantity",
    aggregateAcrossOptions: true,
    eligibleSellingOptionIds: ["piece", "pack"],
    pricingMode: "threshold",
    tiers: [{ id: "tier-12", minimumQuantity: 12, pricePerBaseUnitMinor: 85000 }]
  };
  const quantity = deriveTierQualificationQuantity({
    rule,
    lines: [
      { sellingOptionId: "pack", quantity: 1, stockUnitsPerSaleUnit: 6 },
      { sellingOptionId: "piece", quantity: 6, stockUnitsPerSaleUnit: 1 }
    ]
  });
  assert.equal(quantity, 12);
});

test("does not combine different selling options unless cross-option aggregation is enabled", () => {
  const rule = {
    enabled: true,
    qualificationBasis: "base_stock_quantity",
    aggregateAcrossOptions: false,
    eligibleSellingOptionIds: ["piece", "pack"],
    pricingMode: "threshold",
    tiers: [{ id: "tier-12", minimumQuantity: 12, pricePerBaseUnitMinor: 85000 }]
  };
  assert.throws(() => deriveTierQualificationQuantity({
    rule,
    lines: [
      { sellingOptionId: "pack", quantity: 1, stockUnitsPerSaleUnit: 6 },
      { sellingOptionId: "piece", quantity: 6, stockUnitsPerSaleUnit: 1 }
    ]
  }), error => error.code === "CROSS_OPTION_AGGREGATION_DISABLED");
});

test("ignores selling options excluded from a tier rule", () => {
  const quantity = deriveTierQualificationQuantity({
    rule: {
      enabled: true,
      qualificationBasis: "base_stock_quantity",
      aggregateAcrossOptions: true,
      eligibleSellingOptionIds: ["piece"],
      pricingMode: "threshold",
      tiers: [{ id: "tier-6", minimumQuantity: 6, pricePerBaseUnitMinor: 85000 }]
    },
    lines: [
      { sellingOptionId: "piece", quantity: 6, stockUnitsPerSaleUnit: 1 },
      { sellingOptionId: "carton", quantity: 1, stockUnitsPerSaleUnit: 48 }
    ]
  });
  assert.equal(quantity, 6);
});


test("basket baseline override is preserved when threshold is not reached", () => {
  const result = calculateQuantityTierPrice({
    rule: {
      ...thresholdRule,
      tiers: [{ id: "bulk-5", minimumQuantity: 5, priceBySellingOptionId: { piece: 90000 } }]
    },
    quantity: 2,
    baseUnitPriceMinor: 0,
    baseTotalMinorOverride: 175000,
    sellingOptionId: "piece"
  });
  assert.equal(result.applied, false);
  assert.equal(result.baseTotalMinor, 175000);
  assert.equal(result.totalMinor, 175000);
  assert.equal(result.discountMinor, 0);
});
