import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBlendedPackagePrice,
  calculateFixedEffectiveUnitPrice,
  calculatePercentageDiscount,
  calculateFixedAmountDiscount,
  toBaseQuantity,
  tierQualifies
} from "../src/domain/quantity-pricing.mjs";

test("calculates blended price as one pack plus four loose units", () => {
  const result = calculateBlendedPackagePrice({
    baseQuantity: 10,
    packageBaseQuantity: 6,
    packagePriceMinor: 500000,
    remainderUnitPriceMinor: 100000
  });

  assert.equal(result.packageCount, 1);
  assert.equal(result.remainderQuantity, 4);
  assert.equal(result.totalMinor, 900000);
  assert.equal(result.effectiveUnitPriceMinor, 90000);
});

test("calculates fixed effective unit price", () => {
  const result = calculateFixedEffectiveUnitPrice({
    baseQuantity: 10,
    pricePerBaseUnitMinor: 85000
  });
  assert.deepEqual(result, {
    totalMinor: 850000,
    effectiveUnitPriceMinor: 85000
  });
});

test("calculates percentage discount using basis points", () => {
  assert.deepEqual(calculatePercentageDiscount({
    baseTotalMinor: 1000000,
    discountBasisPoints: 1250
  }), {
    baseTotalMinor: 1000000,
    discountMinor: 125000,
    totalMinor: 875000
  });
});

test("caps fixed discount at the eligible subtotal", () => {
  assert.deepEqual(calculateFixedAmountDiscount({
    baseTotalMinor: 50000,
    discountMinor: 80000
  }), {
    baseTotalMinor: 50000,
    discountMinor: 50000,
    totalMinor: 0
  });
});

test("converts selected selling quantity to base quantity", () => {
  assert.equal(toBaseQuantity({
    quantity: 2,
    stockUnitsPerSaleUnit: 6
  }), 12);
});

test("checks inclusive quantity tier boundaries", () => {
  assert.equal(tierQualifies({
    quantity: 10,
    minimumQuantity: 6,
    maximumQuantity: 12
  }), true);
  assert.equal(tierQualifies({
    quantity: 13,
    minimumQuantity: 6,
    maximumQuantity: 12
  }), false);
});

test("rejects fractional quantities for countable units", () => {
  assert.throws(() => toBaseQuantity({
    quantity: 1.5,
    stockUnitsPerSaleUnit: 6
  }), TypeError);
});

test("rejects negative and unsafe money values", () => {
  assert.throws(() => calculateFixedEffectiveUnitPrice({
    baseQuantity: 2,
    pricePerBaseUnitMinor: -1
  }), TypeError);
  assert.throws(() => calculateFixedEffectiveUnitPrice({
    baseQuantity: Number.MAX_SAFE_INTEGER,
    pricePerBaseUnitMinor: 2
  }), RangeError);
});
