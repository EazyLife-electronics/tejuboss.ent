# Legacy Delivery Pricing Audit

Status: Existing behaviour mapped; safe migration contract not yet approved.

## Existing configuration

The legacy admin settings expose deliveryFeePerItem (defaulting in the UI to NGN 750), deliveryDiscountPercent (defaulting to 10%), minOrderValue, variant-level deliveryFee override, and variant-level deliveryRoute selection (general or separate).

The legacy pricing module calculates delivery using a cascading discount, not a conventional flat percentage. Each next item adds its fee to the running total and then discounts the entire running total. For mixed fees, units are processed in cart order. General-route units share a pool; separate-route units are grouped by product and variant and discounted independently.

## Migration risks

1. Order-dependent result: mixed-fee cascading calculation processes units in cart order, so line ordering can affect the result. A backend implementation must not accidentally preserve or change this without an explicit business decision.
2. Per-physical-unit expansion: the legacy calculation expands quantities into arrays. This is not safe for large/unbounded quantities and is not a suitable trusted backend algorithm as-is.
3. Currency representation: legacy values appear to be whole naira numbers, while the new backend uses integer minor units (kobo). Conversion and rounding need explicit tests.
4. Delivery route semantics: separate groups are keyed by product and variant, while the new catalogue uses stable variant IDs and selling options. A mapping must be agreed.
5. Pickup: delivery must be zero or absent for pickup, regardless of any product-level delivery override.
6. Minimum order: the legacy setting exists, but its scope and enforcement point need confirmation. It must be evaluated against trusted merchandise totals, not client totals.
7. Location/area: legacy order data contains address/area information, but there is no verified launch delivery-zone/rate table in the inspected configuration.

## Safe target contract

Before checkout can be marked ready, define a versioned server-owned delivery policy with enabled state and effective dates, general delivery base fee, optional variant/option overrides, route/grouping behaviour, discount method and deterministic calculation order, supported delivery areas/zones and any zone-specific charges, minimum order amount and whether it applies to pickup, rounding rule in kobo, and a customer-facing explanation and policy version.

The browser may preview the policy, but the backend must calculate the final delivery amount from trusted product and settings records. The order snapshot must preserve the policy version, inputs, grouping decisions, and final fee.

Do not port the cascading calculation blindly. Its cart-order dependence and unit expansion require a deliberate replacement or explicit compatibility decision.
