import test from "node:test";
import assert from "node:assert/strict";
import { buildPublishedCatalogueProduct } from "../src/domain/catalogue-publication.mjs";

const draft = {
  id: "product_demo",
  name: "Rice",
  brand: "Farm",
  category: "Groceries",
  description: "Long grain rice",
  published: true,
  variants: [{
    id: "variant_1",
    active: true,
    stockUnit: { code: "piece", label: "Piece" },
    quantityPrecision: 0,
    sellingOptions: [
      { id: "piece", unitCode: "piece", displayName: "Piece", stockUnitsPerSaleUnit: 1, minimumOrderQuantity: 1, orderQuantityStep: 1, active: true, priceMinor: 250000 },
      { id: "carton", unitCode: "carton", displayName: "Carton", stockUnitsPerSaleUnit: 12, minimumOrderQuantity: 1, orderQuantityStep: 1, active: false, priceMinor: 2500000 }
    ]
  }]
};

test("builds a public-safe product and excludes inactive selling options", () => {
  const product = buildPublishedCatalogueProduct(draft);
  assert.equal(product.published, true);
  assert.equal(product.catalogueSchemaVersion, 2);
  assert.deepEqual(product.variants[0].sellingOptions.map(x => x.id), ["piece"]);
  assert.equal("stockQty" in product, false);
  assert.equal("costPrice" in product, false);
});

test("rejects drafts not explicitly marked for publication", () => {
  assert.throws(() => buildPublishedCatalogueProduct({ ...draft, published: false }), /marked for publication/);
});

test("rejects products without at least one active sellable option", () => {
  const noActive = structuredClone(draft);
  noActive.variants[0].sellingOptions[0].active = false;
  assert.throws(() => buildPublishedCatalogueProduct(noActive), /valid active storefront catalogue/);
});

test("preserves stable IDs and explicit stock conversions", () => {
  const product = buildPublishedCatalogueProduct(draft);
  assert.equal(product.variants[0].id, "variant_1");
  assert.equal(product.variants[0].sellingOptions[0].stockUnitsPerSaleUnit, 1);
});
