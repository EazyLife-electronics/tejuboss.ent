import test from "node:test";
import assert from "node:assert/strict";
import { toPublicCatalogueCard, publicOptionUnitPrice } from "../src/domain/public-catalogue-view.mjs";

const product = {
  catalogueSchemaVersion: 2,
  sourceDraftId: "draft_1",
  name: "Laundry Soap",
  brand: "Teju",
  category: "Household",
  description: "Sample description",
  published: true,
  variants: [{
    id: "variant_1",
    active: true,
    stockUnit: { code: "piece", label: "Piece" },
    quantityPrecision: 0,
    sellingOptions: [{
      id: "option_1",
      unitCode: "piece",
      displayName: "Single piece",
      stockUnitsPerSaleUnit: 1,
      minimumOrderQuantity: 1,
      orderQuantityStep: 1,
      active: true,
      priceMinor: 125000,
      promoPriceMinor: 110000
    }]
  }]
};

test("public catalogue view keeps customer-facing fields and stable option IDs", () => {
  const card = toPublicCatalogueCard(product, "firestore_product_1");
  assert.equal(card.id, "firestore_product_1");
  assert.equal(card.name, "Laundry Soap");
  assert.equal(card.variants[0].id, "variant_1");
  assert.equal(card.variants[0].quantityPrecision, 0);
  assert.equal(card.variants[0].sellingOptions[0].id, "option_1");
  assert.equal(card.variants[0].sellingOptions[0].priceMinor, 125000);
  assert.equal("stockQty" in card.variants[0], false);
});

test("unpublished or malformed catalogue records are rejected", () => {
  assert.throws(() => toPublicCatalogueCard({ ...product, published: false }));
  assert.throws(() => toPublicCatalogueCard({ ...product, variants: [] }));
});

test("public display uses a valid lower promotional price only", () => {
  assert.equal(publicOptionUnitPrice({ priceMinor: 10000, promoPriceMinor: 8000 }), 8000);
  assert.equal(publicOptionUnitPrice({ priceMinor: 10000, promoPriceMinor: 12000 }), 10000);
  assert.throws(() => publicOptionUnitPrice({ priceMinor: -1 }));
});
