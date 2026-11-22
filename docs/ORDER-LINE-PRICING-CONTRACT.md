# Trusted Order Line Pricing

Status: Implemented as a pure domain calculation; not connected to live checkout.

## Responsibilities

`calculateCatalogueLinePrice` accepts a trusted catalogue product, stable variant and selling-option IDs, and a requested quantity. It:
- resolves only active options by stable IDs;
- uses the catalogue's integer minor-unit price, never a browser-submitted price;
- applies a promotional price only when it is explicitly present in the catalogue;
- validates minimum quantity, configured order step and quantity precision;
- calculates stock consumption from the explicit selling-option conversion;
- returns a line-price snapshot suitable for a trusted order service.

## Deliberate boundaries

This module does not read Firestore, create orders, reserve stock, calculate delivery, or apply quantity tiers. Those operations belong in a trusted backend service.

Quantity-tier pricing is intentionally not guessed. The business must confirm whether a tier is:
- **Threshold pricing:** once the qualifying quantity is reached, the tier price applies to all eligible units in its configured scope.
- **Marginal/slab pricing:** each price applies only to units within its quantity band.

Cross-unit qualification is a separate decision from the price unit. For example, a customer ordering 10 individual pieces may qualify using a pack-equivalent threshold while still receiving 10 pieces. The rule must explicitly define that behavior and whether qualification aggregates across selling options.

## Money and rounding

Prices and totals are integer minor currency units (kobo for NGN). Fractional sale quantities are accepted only within the variant's configured precision. Line totals are rounded half-up to the nearest kobo.

## Tests

Covered by `functions/test/order-pricing.test.mjs` and the domain CI job.
