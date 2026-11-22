/**
 * Synthetic Tejuboss test catalogue.
 * These records are fixtures only; never seed a live Firebase project with them.
 */
export const sampleProducts = new Map([
  ["sample-led-bulb", {
    published: true,
    name: "Sample LED Bulb (TEST FIXTURE)",
    variants: [{
      id: "warm-white",
      active: true,
      stockUnit: { code: "piece" },
      quantityPrecision: 0,
      sellingOptions: [
        {
          id: "single-piece",
          unitCode: "piece",
          displayName: "1 piece",
          stockUnitsPerSaleUnit: 1,
          minimumOrderQuantity: 1,
          orderQuantityStep: 1,
          active: true,
          priceMinor: 150000
        },
        {
          id: "sealed-carton",
          unitCode: "carton",
          displayName: "Carton of 48",
          stockUnitsPerSaleUnit: 48,
          minimumOrderQuantity: 1,
          orderQuantityStep: 1,
          active: true,
          priceMinor: 6000000
        }
      ]
    }]
  }],
  ["sample-extension-cable", {
    published: true,
    name: "Sample Extension Cable (TEST FIXTURE)",
    variants: [{
      id: "3m-white",
      active: true,
      stockUnit: { code: "piece" },
      quantityPrecision: 0,
      sellingOptions: [{
        id: "single-piece",
        unitCode: "piece",
        displayName: "1 piece",
        stockUnitsPerSaleUnit: 1,
        minimumOrderQuantity: 1,
        orderQuantityStep: 1,
        active: true,
        priceMinor: 850000
      }]
    }]
  }]
]);

export const sampleDeliveryPolicy = {
  enabled: true,
  version: "fixture-v1",
  method: "flat_per_order",
  baseFeeMinor: 75000,
  zoneFeesMinor: {
    "ibadan-central": 25000,
    "ibadan-outskirts": 50000
  }
};

export const sampleInventory = {
  locationId: "sample-ibadan-store",
  productId: "sample-led-bulb",
  variantId: "warm-white",
  unitsPerSealedCarton: 48,
  sealedCartons: 10,
  loosePieces: 0
};
