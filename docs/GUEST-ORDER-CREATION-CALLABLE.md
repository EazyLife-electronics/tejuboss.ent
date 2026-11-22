# Trusted Guest Order Creation

Status: Development callable exported; not deployed or wired to the live storefront.

## Endpoint
Callable: `createGuestOrder` in `functions/src/guest-order.mjs`.

Request is strictly limited to:
- `sessionToken`: raw guest bearer token returned once by `createGuestCheckoutSession`;
- `order`: validated customer/order intent, stable product/variant/selling-option IDs and quantities.

The browser cannot submit prices, discounts, delivery fees, inventory IDs, stock quantities, order totals, status, or payment state.

## Transaction behaviour
The callable:
1. Verifies App Check and guest-only usage.
2. Hashes and validates the session credential against the private session record.
3. Applies idempotency scoped to that session.
4. Reads current published structured catalogue records.
5. Reads private server-side quantity-tier configuration.
6. Reads the active delivery policy for delivery orders; pickup is zero-fee.
7. Reads private inventory mappings and derives stock consumption from the published option's explicit conversion.
8. Calculates all prices and delivery fees on the server.
9. Creates the order, tracking projection, idempotency record and audit record in one Firestore transaction.

Order status is `awaiting_confirmation`, payment status is `unpaid`, and fulfilment status is `unfulfilled`. No stock is reserved or deducted at placement.

## Required backend configuration before a real order can be accepted
- Published structured catalogue item and active selling options.
- Private `inventoryMappings` record for every checkout option, keyed by SHA-256 of the ordered stable-ID tuple [productId, variantId, sellingOptionId], matching product, variant, option and explicit conversion. Required mapping fields: balanceId, stockUnitsPerSaleUnit (must match catalogue), stockUnitsPerBalanceUnit (canonical stock units per unit in that balance), productId, variantId, sellingOptionId, locationId, inventoryFormId, stockUnitCode. Optional sealed fallback: sealedBalanceId, sealedInventoryFormId, unitsPerPackage. The current confirmation transaction safely supports a single loose primary balance with a sealed-package fallback, or a directly selected inventory form. Mixed overlapping balances fail closed until the basket allocation planner is expanded.
- Active delivery policy at `deliveryPolicies/active` for delivery orders, with enabled method, version, base fee and area fees.
- Private quantity-tier configuration, if bulk pricing is enabled.
- Guest session issuer deployed and App Check configured.
- Order confirmation callable deployed with valid staff custom claims.
- Inventory balances initialized from a physically reconciled opening stock.

Missing or inconsistent inventory mappings fail closed. This is deliberate: the service will not guess from a grocery product label or legacy `stockQty`.

## Important rollout boundary
The existing legacy storefront remains untouched. This callable is not deployed, and its new collections are not initialized in production. Do not deploy it until the admin mapping/opening-balance workflow, delivery configuration, staff role provisioning and customer-facing pending-confirmation wording are complete and verified.
