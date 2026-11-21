import test from "node:test";
import assert from "node:assert/strict";
import { applyQuantityTierRules } from "../src/domain/apply-quantity-tier-rules.mjs";

const baseLine = (overrides = {}) => ({
  productId: "lamp",
  variantId: "white",
  sellingOptionId: "piece",
  quantity: 1,
  stockUnitsPerSaleUnit: 1,
  subtotalMinor: 100000,
  appliedUnitPriceMinor: 100000,
  totalMinor: 100000,
  discountMinor: 0,
  pricingSource: "catalogue_base",
  ...overrides
});

test("threshold tier aggregates same-option basket lines and allocates exact discount", () => {
  const result = applyQuantityTierRules({
    lines: [
      baseLine({ quantity: 2, subtotalMinor: 200000, totalMinor: 200000 }),
      baseLine({ quantity: 3, subtotalMinor: 300000, totalMinor: 300000 })
    ],
    rules: [{
      productId: "lamp",
      variantId: "white",
      rule: {
        id: "piece-bulk",
        enabled: true,
        qualificationBasis: "selected_option_quantity",
        aggregateAcrossOptions: false,
        eligibleSellingOptionIds: ["piece"],
        pricingMode: "threshold",
        tiers: [{
          id: "five-plus",
          minimumQuantity: 5,
          priceBySellingOptionId: { piece: 90000 }
        }]
      }
    }]
  });

  assert.equal(result.subtotalMinor, 500000);
  assert.equal(result.discountMinor, 50000);
  assert.equal(result.merchandiseTotalMinor, 450000);
  assert.deepEqual(result.lines.map(line => line.totalMinor), [180000, 270000]);
  assert.deepEqual(result.lines.map(line => line.quantityTierDiscountMinor), [20000, 30000]);
  assert.equal(result.appliedTierRules[0].qualificationQuantity, 5);
});

test("base-stock rule qualifies across explicit piece and pack conversions", () => {
  const result = applyQuantityTierRules({
    lines: [
      baseLine({
        sellingOptionId: "pack",
        quantity: 1,
        stockUnitsPerSaleUnit: 6,
        subtotalMinor: 600000,
        appliedUnitPriceMinor: 600000,
        totalMinor: 600000
      }),
      baseLine({
        quantity: 6,
        subtotalMinor: 600000,
        totalMinor: 600000
      })
    ],
    rules: [{
      productId: "lamp",
      variantId: "white",
      rule: {
        id: "equivalent-volume",
        enabled: true,
        qualificationBasis: "base_stock_quantity",
        aggregateAcrossOptions: true,
        eligibleSellingOptionIds: ["piece", "pack"],
        pricingMode: "threshold",
        tiers: [{
          id: "twelve-base-units",
          minimumQuantity: 12,
          pricePerBaseUnitMinor: 85000
        }]
      }
    }]
  });

  assert.equal(result.appliedTierRules[0].qualificationQuantity, 12);
  assert.equal(result.merchandiseTotalMinor, 1020000);
  assert.equal(result.discountMinor, 180000);
  assert.equal(result.lines.reduce((sum, line) => sum + line.totalMinor, 0), 1020000);
});

test("catalogue promotions do not stack with quantity tiers", () => {
  const result = applyQuantityTierRules({
    lines: [baseLine({
      quantity: 10,
      subtotalMinor: 1000000,
      appliedUnitPriceMinor: 80000,
      totalMinor: 800000,
      discountMinor: 200000,
      pricingSource: "catalogue_promotion"
    })],
    rules: [{
      productId: "lamp",
      variantId: "white",
      rule: {
        enabled: true,
        qualificationBasis: "selected_option_quantity",
        aggregateAcrossOptions: false,
        eligibleSellingOptionIds: ["piece"],
        pricingMode: "threshold",
        tiers: [{ id: "bulk", minimumQuantity: 5, priceBySellingOptionId: { piece: 70000 } }]
      }
    }]
  });

  assert.equal(result.merchandiseTotalMinor, 800000);
  assert.equal(result.appliedTierRules.length, 0);
});

test("rejects overlapping enabled rules targeting the same line", () => {
  const rule = {
    enabled: true,
    qualificationBasis: "selected_option_quantity",
    aggregateAcrossOptions: false,
    eligibleSellingOptionIds: ["piece"],
    pricingMode: "threshold",
    tiers: [{ id: "bulk", minimumQuantity: 2, priceBySellingOptionId: { piece: 90000 } }]
  };
  assert.throws(() => applyQuantityTierRules({
    lines: [baseLine({ quantity: 2, subtotalMinor: 200000, totalMinor: 200000 })],
    rules: [
      { productId: "lamp", variantId: "white", rule },
      { productId: "lamp", variantId: "white", rule }
    ]
  }), error => error.code === "INVALID_TIER_CONFIGURATION");
});

test("without configured rules the catalogue quote remains unchanged", () => {
  const line = baseLine();
  const result = applyQuantityTierRules({ lines: [line] });
  assert.equal(result.merchandiseTotalMinor, line.totalMinor);
  assert.equal(result.discountMinor, line.discountMinor);
  assert.deepEqual(result.appliedTierRules, []);
});
