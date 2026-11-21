# Tejuboss Phase 0: Repository and Architecture Audit

Audit date: 2026-11-21
Working branch: `tejuboss-foundation`
Production branch: `main` (not modified)
Firebase project: `tejuboss-ent` (not changed)

## Executive decision

Proceed with a Tejuboss-specific rebuild using EazyLife as a source of proven patterns and selected modules, not as a wholesale clone. The existing Tejuboss code is a useful source of business workflows and data conventions, but it is not a safe or complete target architecture.

No production rules, database data, Firebase configuration or deployments were changed during this audit.

## Repository comparison

- EazyLife main contains 243 tracked paths in the inspected tree.
- Tejuboss foundation contains 88 tracked paths.
- Tejuboss already contains a number of EazyLife-derived operational modules: inventory, purchases, suppliers, payments, receivables, delivery, customer records and reports.
- Tejuboss's public/admin shell is substantially smaller. Its current admin page is a compact single-page dashboard with dynamically injected purchase, inventory, reporting and delivery sections.
- EazyLife contains additional modular admin capabilities, including richer media management, customer/quotation tooling, broader reporting and a more developed admin orchestration pattern. These are candidates for selective reuse, subject to Tejuboss-specific review.

The raw file-count comparison is not a quality score. Each module must be checked for actual dependency, data-model and workflow compatibility before copying.

## Confirmed current Tejuboss data conventions

### Catalogue

The current Firestore-facing product editor stores products with fields such as:
- `name`, `brand`, `category`, `desc`, `inStock`
- embedded `variants[]`
- variant `id`, `price`, `promoPrice`, `image`, product attributes
- inventory-related variant fields `sku`, `stockQty`, `reorderLevel`, `costPrice`
- optional delivery fields `deliveryFee`, `deliveryRoute`
- optional `bulkSavingsEnabled`, `bulkSavingsMode`, `bulkSavingsPercent`, `bulkSavingsMinQty`

The legacy `products.json` file is a different flat import/catalogue shape: numeric IDs, one price per product and no embedded variant array. It must not be mistaken for a verified export of the current Firestore catalogue.

### Pricing

The existing storefront uses shared pricing helpers for:
- variant promotional price
- line-level bulk savings and thresholds
- grouped/cascading delivery charges
- delivery fee overrides and routes

The browser calculates subtotal, discounts, delivery and total before calling `placeOrder()`. These calculations are useful for display, but are not trustworthy as the final order amount. The server must reproduce the agreed pricing rules using current catalogue and settings data.

The current product model does not yet establish a clear, general-purpose retail/wholesale price-list model, carton conversion model or customer-specific negotiated pricing model. These should be designed explicitly rather than overloaded into the current `price` field.

### Inventory

Current Tejuboss inventory is embedded in each product's variant array:
- `stockQty`, `reorderLevel`, `costPrice`, and `sku` live on each variant.
- Inventory adjustments use Firestore transactions and write to `inventoryMovements`.
- Purchases increase variant stock and write purchase and movement records.
- Order confirmation deducts stock; cancellation/return can restore stock.

This is a useful single-stock-pool foundation, but it does not represent separate outlets or warehouses. A future location-aware design should use inventory records keyed by location and sellable variant, with a migration plan. Do not simply duplicate the embedded quantity into multiple places and risk divergent stock figures.

### Orders, payments and delivery

- The browser currently writes orders directly to `orders`.
- Tracking codes use a short six-character suffix generated with `Math.random()`.
- The storefront sends product IDs, variant labels, displayed unit prices, quantities and browser-calculated totals.
- The client attempts to resolve a missing variant ID by matching a human-readable label; labels can be ambiguous and should not be the canonical identifier.
- Public tracking reads the full order document.
- Public tracking can then read a full delivery document by delivery ID.
- Private payment records are stored under `orders/{orderId}/payments`.
- Payment status is calculated separately from fulfilment status, which is a sound separation to preserve.
- Delivery is a separate operational record and has its own state transitions.

### Firestore security

The current Tejuboss rules have important security gaps:
- `orders` permits public `get`, exposing complete customer/order documents to anyone who knows a tracking document ID.
- `deliveries` permits public `get`, exposing the complete delivery document, including operational/customer fields.
- `reviews` permits public reads of all records, rather than approved records only.
- Public order creation accepts browser-provided prices and totals after only basic type/presence checks.
- Product catalogue is public-read/admin-write, which can remain appropriate if only published product data is exposed; drafts/private cost fields should not be included in a publicly readable document.

The current EazyLife rules have a more complete collection coverage and approved-review restriction, but still permit public full-order and full-delivery reads. Therefore, EazyLife's existing rules are not safe to copy as-is. Tejuboss needs a deliberately designed access matrix and new rules.

Do not tighten the existing public order/delivery reads until a replacement tracking endpoint/projection and legacy-order compatibility plan are ready.

## Reuse / redesign / discard matrix

| Area | Recommendation | Reason |
|---|---|---|
| Firebase project configuration | Reuse Tejuboss config only | Keep the dedicated `tejuboss-ent` project isolated from EazyLife. |
| Firebase initialization pattern | Reuse pattern, redesign module | Centralized initialization and optional App Check are useful; do not copy EazyLife credentials or unfinished site key. |
| Product admin | Redesign | Current editor assumes embedded variants and electronics-style attributes relabelled for groceries. Add explicit unit/pack/carton and wholesale concepts. |
| Pricing helpers | Reuse selectively, make server-compatible | Promo, bulk and delivery logic is valuable but must be authoritative server-side and tested against checkout examples. |
| Inventory ledger | Reuse concepts, redesign data model | Transactional movements and cost/reorder fields are useful; location-aware stock is needed for distribution. |
| Purchases/suppliers | Reuse after review | Existing purchase receiving and supplier records provide a useful operational base. |
| Order/payment lifecycle | Preserve business concepts, rebuild trust boundary | Keep payments separate from fulfilment; move customer submission and authoritative totals to trusted backend functions. |
| Delivery workflow | Reuse lifecycle concepts, redesign public projection | Keep private rider/recipient operational details out of public tracking. |
| Admin shell | Rebuild modularly | Current Teju admin shell is compact and uses mixed inline/dynamic initialization. EazyLife's modular conventions are a stronger reference. |
| Reviews/requests | Redesign access and validation | Current public review reads are too broad; public request submission needs abuse controls and strict validation. |
| Media management | Assess and selectively port | EazyLife's media tooling may be useful, but repo paths, folders, permissions and branding must be Tejuboss-specific. |
| SEO/theme/navigation | Reuse patterns, redesign brand content | Keep Tejuboss's brand, domain, product categories and retail messaging. |
| Wholesale/retailer accounts | Build new | Not adequately represented by the current product price field or retail checkout. |
| Multi-location inventory | Build new | Current stock is one quantity embedded in each product variant. |
| Marketplace tenancy/settlement | Defer | Not needed for dependable first-party retail and wholesale launch. |

## Proposed target architecture

### Catalogue and commercial rules
- `categories`
- `products` (public merchandising data only)
- `productVariants` or a stable embedded-variant contract
- `priceLists` and customer-group assignments
- `promotions`
- explicit sellable units and pack/carton conversion rules

### Stock and procurement
- `locations`
- `inventory` keyed by location and variant/SKU
- immutable `stockMovements`
- `stockReservations` where required
- `suppliers`, `purchaseOrders`, `goodsReceipts`

### Customers and orders
- private `customers`
- `retailerAccounts`
- private `orders`
- private payment ledger
- private `deliveries`
- restricted `publicOrderTracking` projection

### Administration and governance
- role-based admin permissions
- `auditLogs`
- configuration/settings with explicit public/private separation

This is a target model for specification, not a command to create all collections immediately. The first implementation should use only the minimum collections needed for the retail launch, while keeping the schema extensible.

## Next implementation sequence

1. Confirm sellable product unit conventions: individual unit, pack, carton/case, and whether one catalogue item can be sold in more than one of these forms.
2. Define retail, wholesale and approved-customer price rules, including whether prices are inclusive of delivery or delivery is calculated separately.
3. Define location/warehouse stock ownership and whether online orders can be fulfilled from more than one location.
4. Produce the Firestore collection schema, role/access matrix and migration plan.
5. Implement and test trusted order pricing/submission and safe tracking in Firebase emulators before connecting the live Tejuboss project.
6. Rebuild storefront and admin modules against the agreed contracts.

## Safety status

- `main` remains untouched.
- No Firebase deployment or database mutation was performed.
- No security rules were deployed.
- No existing customer/order/product records were migrated or deleted.
- `tejuboss-ecommerce-v2` remains available as a reference branch.
