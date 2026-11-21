# Trusted Checkout Catalogue Contract

Status: Proposed target schema, not yet applied to Firebase  
Branch: `tejuboss-foundation`

## Why this contract exists

The current Tejuboss catalogue is a legacy product document with embedded variants, naira-denominated browser-facing prices, and a single `stockQty` value. It does not yet contain explicit selling options, stock-unit conversions, or separate sealed/loose inventory balances.

The trusted checkout must not guess those missing values from product names, descriptions, SKUs, or labels. The new validator therefore rejects incomplete legacy records rather than silently inventing a conversion.

## Target product document

The initial migration can keep one product document per product and embedded variants, to minimize disruptive catalogue movement. Each checkout-enabled product must have:

```js
{
  name: "Example product",
  published: true,
  variants: [
    {
      id: "stable-variant-id",
      active: true,
      sku: "OPTIONAL-SKU",
      label: "Original",
      stockUnit: {
        code: "piece",
        label: "Piece"
      },
      quantityPrecision: 0,
      sellingOptions: [
        {
          id: "piece",
          unitCode: "piece",
          displayName: "Piece",
          stockUnitsPerSaleUnit: 1,
          minimumOrderQuantity: 1,
          orderQuantityStep: 1,
          active: true,
          priceMinor: 100000
        },
        {
          id: "carton",
          unitCode: "carton",
          displayName: "Carton of 48",
          stockUnitsPerSaleUnit: 48,
          minimumOrderQuantity: 1,
          orderQuantityStep: 1,
          active: true,
          priceMinor: 4000000
        }
      ]
    }
  ]
}
```

The amounts above are examples only. `priceMinor` is integer kobo: ₦1,000 is 100000. They are not actual Tejuboss prices.

## Pricing rules

Pricing configuration is private and separate from public product display. Each rule must explicitly identify:
- product ID, variant ID, and applicable selling-option IDs;
- public customer class;
- qualification basis: selected selling quantity or configured equivalent/base quantity;
- minimum and optional maximum threshold;
- price method and its integer-minor-unit parameters;
- active period, enabled state, stacking policy and priority;
- public description of the offer.

The launch default is a threshold price: when the qualifying quantity reaches a published threshold, the configured price applies to all eligible units in that line/basket scope. A future admin setting may support marginal/slab pricing separately. No price tier is active merely because it exists; it must be explicitly enabled and published.

## Inventory balances

Checkout-enabled stock must be represented separately from the legacy `stockQty` field. Proposed balance identity is location + variant + stock form, for example:
- `main-store / variant-id / loose-piece`
- `main-store / variant-id / sealed-carton`

Each balance stores integer quantity, reserved quantity, reorder threshold and update metadata. Package forms reference explicit conversions. A loose-unit sale can open sealed cartons only where the configured conversion explicitly permits it. The break-pack movement and sale deduction must be committed in the same Firestore transaction.

## Migration rules

1. Existing product documents and the live storefront remain unchanged during initial implementation.
2. Legacy products remain visible and purchasable through the existing flow until each is migrated and verified.
3. A product is eligible for trusted checkout only after its stable variant IDs, stock unit, selling options, conversion, public price and inventory forms are explicitly reviewed.
4. Do not copy the legacy `stockQty` into multiple new inventory balances. Reconcile the physical store count and packaging forms before migration.
5. Do not convert legacy naira values to kobo automatically without verifying their source and meaning.
6. The backend must reject a basket containing a non-migrated product with a clear catalogue-not-ready error; the storefront should continue using the legacy path until the migration is ready, rather than silently falling back to client-trusted pricing.
7. The staged Firestore rules are not deployed. Existing rules must remain in place until all public pages, admin workflows, checkout and tracking are migrated and tested.

## Current automated guard

`functions/src/domain/catalogue.mjs` validates the structured product contract and resolves variants/options only by stable IDs. It does not access Firestore and does not write orders or stock.

Run in CI:
- `npm test` for catalogue, pricing and inventory domain tests.
- `npm run test:rules` for Firestore Emulator security rules tests.

## What must be verified before live migration

- A representative live Firestore product document with multiple variants, if present.
- Current store settings used by delivery and general bulk pricing.
- One real example each of a product sold by unit, pack/carton, and roll where those exist.
- The actual deployed Firestore rules from Firebase Console if they differ from the repository copy.
- A physical stock reconciliation for the first products enabled for online checkout.
