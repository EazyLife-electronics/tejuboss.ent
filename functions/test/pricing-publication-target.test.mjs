import test from "node:test";
import assert from "node:assert/strict";
import { validatePricingPublicationTarget } from "../src/domain/pricing-publication-target.mjs";

const product = {
  published: true,
  variants: [{
    id: "default",
    active: true,
    sellingOptions: [
      { id: "piece", active: true, stockUnitsPerSaleUnit: 1 },
      { id: "carton-48", active: true, stockUnitsPerSaleUnit: 48 },
      { id: "inactive-pack", active: false, stockUnitsPerSaleUnit: 6 }
    ]
  }]
};
const rule = { eligibleSellingOptionIds: ["piece"] };

test("allows publication for an active structured catalogue target", () => {
  assert.deepEqual(
    validatePricingPublicationTarget({ product, variantId: "default", rule }),
    { valid: true, issues: [] }
  );
});

test("rejects unpublished products and missing or inactive variants", () => {
  assert.equal(validatePricingPublicationTarget({
    product: { ...product, published: false }, variantId: "default", rule
  }).valid, false);
  assert.equal(validatePricingPublicationTarget({
    product, variantId: "missing", rule
  }).valid, false);
  assert.equal(validatePricingPublicationTarget({
    product: { ...product, variants: [{ ...product.variants[0], active: false }] },
    variantId: "default", rule
  }).valid, false);
});

test("rejects missing, inactive, or unconverted selling options", () => {
  for (const optionId of ["unknown", "inactive-pack"]) {
    assert.equal(validatePricingPublicationTarget({
      product, variantId: "default",
      rule: { eligibleSellingOptionIds: [optionId] }
    }).valid, false);
  }
  const badConversion = {
    ...product,
    variants: [{
      ...product.variants[0],
      sellingOptions: [{ id: "piece", active: true, stockUnitsPerSaleUnit: 0 }]
    }]
  };
  assert.equal(validatePricingPublicationTarget({
    product: badConversion, variantId: "default", rule
  }).valid, false);
});

test("disabled drafts can be validated independently of a live product", () => {
  // The backend intentionally skips this target validation for disabled drafts.
  // This test documents that the validator itself remains strict when invoked.
  assert.equal(validatePricingPublicationTarget({
    product: { published: false, variants: [] }, variantId: "legacy", rule
  }).valid, false);
});
