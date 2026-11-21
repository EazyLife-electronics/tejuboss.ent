import test from "node:test";
import assert from "node:assert/strict";
import { getPublicOffersForVariant, formatPublicOfferRows } from "../src/domain/public-quantity-offers.mjs";

const variant = {
  id: "variant_1",
  sellingOptions: [
    { id: "piece", displayName: "Piece", stockUnitsPerSaleUnit: 1 },
    { id: "pack", displayName: "Pack of 6", stockUnitsPerSaleUnit: 6 }
  ]
};

test("matches selected-option public offers to stable option IDs", () => {
  const offers = getPublicOffersForVariant({
    productId: "soap",
    variant,
    publicPricing: [{
      publicPricingId: "soap__variant_1__piece_offer",
      productId: "soap",
      variantId: "variant_1",
      enabled: true,
      publicationState: "published",
      qualificationBasis: "selected_option_quantity",
      pricingMode: "threshold",
      eligibleSellingOptionIds: ["piece"],
      tiers: [{ id: "tier_2", minimumQuantity: 2, maximumQuantity: null,
        priceBySellingOptionId: { piece: 90000 } }]
    }]
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].eligibleOptions[0].id, "piece");
  assert.deepEqual(formatPublicOfferRows(offers[0])[0].rates, [
    { unit: "Piece", priceMinor: 90000 }
  ]);
});

test("base-stock offers retain their qualification unit and ignore disabled projections", () => {
  const offers = getPublicOffersForVariant({
    productId: "soap",
    variant,
    publicPricing: [
      { productId: "soap", variantId: "variant_1", enabled: false,
        publicationState: "disabled", eligibleSellingOptionIds: ["piece"],
        tiers: [{ minimumQuantity: 2 }] },
      { productId: "soap", variantId: "variant_1", enabled: true,
        publicationState: "published", qualificationBasis: "base_stock_quantity",
        pricingMode: "threshold", eligibleSellingOptionIds: ["piece", "pack"],
        tiers: [{ id: "tier_12", minimumQuantity: 12, pricePerBaseUnitMinor: 8000 }] }
    ]
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].eligibleOptions.length, 2);
  const row = formatPublicOfferRows(offers[0])[0];
  assert.equal(row.qualificationUnit, "base stock unit");
  assert.equal(row.minimumQuantity, 12);
  assert.equal(row.rates[0].priceMinor, 8000);
});

test("does not match a pricing projection to another product or variant", () => {
  const offers = getPublicOffersForVariant({
    productId: "soap", variant,
    publicPricing: [{ productId: "other", variantId: "variant_1", enabled: true,
      publicationState: "published", eligibleSellingOptionIds: ["piece"],
      tiers: [{ minimumQuantity: 2, priceBySellingOptionId: { piece: 1 } }] }]
  });
  assert.deepEqual(offers, []);
});
