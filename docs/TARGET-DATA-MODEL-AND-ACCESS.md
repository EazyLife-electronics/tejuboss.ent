# Tejuboss Target Data Model and Access Matrix

Status: Proposed technical foundation based on confirmed business requirements
Working branch: `tejuboss-foundation`
Firebase project: `tejuboss-ent`
Production branch: `main` (not modified)

## 1. Design goals

The first release must support:
- public retail prices and public quantity-based upsell offers;
- guest checkout with optional customer accounts;
- multiple selling options for one product/variant;
- separately tracked unopened packages and loose stock;
- automatic break-pack conversion when loose stock is insufficient;
- one active store/fulfilment location;
- trusted server-side pricing, order creation, stock conversion, and stock deduction;
- admin-controlled catalogue, pricing, inventory, procurement, and order operations.

The data model should leave a safe path to additional locations and richer retailer/customer records without implementing a marketplace or multi-branch operations prematurely.

## 2. Core modelling decisions

1. Product identity, variant identity, selling option, inventory form, and pricing rule are separate concepts.
2. A selling option is a customer-facing choice. An inventory form is the physical form in which stock is counted. They may be related, but they are not interchangeable concepts.
3. Every sellable variant has stable IDs. Human-readable labels are not identifiers.
4. Public catalogue and pricing data must not contain supplier costs, private margin targets, or internal operational notes.
5. Browser calculations are previews only. The trusted backend recalculates all order prices and stock requirements.
6. Orders preserve snapshots of the product, option, conversion, and pricing decision that applied at purchase time.
7. Firestore is not the trusted checkout boundary. Public clients must not directly create orders or mutate inventory.

## 3. Proposed Firestore collections

The paths below are a logical target. Implementation may embed small, tightly coupled public data where this improves reads, but it must preserve the security and identity boundaries described here.

### Public catalogue

#### `products/{productId}`

Public fields:
- `name`
- `brand`
- `categoryId`
- `description`
- `images[]`
- `published`
- `searchKeywords[]`
- `createdAt`, `updatedAt`

Do not place cost price, supplier, private margin, internal notes, or unrestricted stock ledger data here.

#### `products/{productId}/variants/{variantId}`

Public fields:
- `sku` only if intended for public display
- `label`
- `attributes{}`
- `stockUnitCode`
- `quantityPrecision`
- `active`
- `sellingOptions[]` or a subcollection if the catalogue becomes large

A selling option contains:
- `id`
- `unitCode`
- `displayName`
- `stockConversion` (base stock units consumed by one selling unit)
- `minimumOrderQuantity`
- `orderQuantityStep`
- `inventoryFormId` or an explicit eligible inventory-form policy
- `active)

For launch, a compact embedded selling-options array is acceptable if each option has a stable ID and updates are validated. If options require independent publishing, audit history, or complex pricing, move them to a subcollection without changing their logical contract.

#### Public pricing projection

Use a deliberately public projection such as `publicPricing/{productVariantKey}` or public-safe pricing fields attached to the public variant. It may contain:
- public base prices;
- public quantity tiers and thresholds;
- public display text/conditions;
- effective dates and enabled state.

It must not expose private cost, supplier, gross-margin target, or internal pricing rationale. The projection is generated/updated by trusted admin actions from the authoritative private pricing configuration.

### Private commercial configuration

#### `pricingConfigs/{variantId}` (or product/variant subcollection)

Private/admin-only authoritative configuration:
- retail base prices per selling option;
- enabled quantity tiers;
- pricing method and qualification basis;
- eligible selling options and customer classes;
- effective dates;
- stacking policy;
- optional internal cost/margin references;
- publication state and audit metadata.

Do not return internal cost or target margin fields to public clients.

### Inventory

#### `locations/{locationId}`

For launch, create one active store location. Store:
- name and operational address;
- active status;
- fulfilment settings;
- timestamps.

#### `inventoryBalances/{balanceId}`

One balance per location + variant + inventory form. Use a deterministic key or enforce uniqueness in trusted backend code.

Fields:
- `locationId`
- `productId`
- `variantId`
- `inventoryFormId`
- `inventoryFormCode` (e.g. sealed_carton, loose_piece, sealed_pack, roll)
- `quantityOnHand`
- `quantityReserved`
- `quantityPrecision`
- `reorderLevel`
- `updatedAt`

Available stock is `quantityOnHand - quantityReserved` for that exact inventory form. Do not maintain an independently editable aggregate balance.

#### `inventoryForms/{formId}` (or immutable form definitions under a variant)

Defines the physical stock form:
- `id`
- `label`
- `stockUnitCode`
- `baseUnitsPerForm`
- `isSealedPackage`
- `breaksIntoFormId` (optional)
- `breakQuantity` (optional)
- `active`

Example: a sealed carton can convert to 48 loose pieces. The configured package contents are data, never parsed from a product title.

#### `inventoryMovements/{movementId}`

Append-only ledger:
- `type` (receipt, sale, reservation, release, break_pack, adjustment, return, transfer when later supported)
- `locationId`
- `productId`, `variantId`
- `fromInventoryFormId`, `toInventoryFormId` where relevant
- `quantityFrom`, `quantityTo`
- `baseQuantity` where meaningful
- `orderId`, `purchaseId`, or reference ID
- `reason`
- `actorUid` or trusted system actor
- `createdAt`
- `beforeBalances{}`, `afterBalances{}`

For a break-pack, record a linked conversion movement and sale movement, or a single compound movement with auditable legs. Never overwrite or delete ledger history during normal operations.

### Orders and customer records

#### `orders/{orderId}`

Private order document:
- tracking code hash or protected lookup reference;
- customer name, phone, email if supplied, delivery/pickup details;
- immutable item snapshots;
- subtotal, tier savings, other discounts, delivery, total, currency;
- payment status and fulfilment status as separate state fields;
- timestamps and status history;
- source (guest/account/admin).

Do not expose the full order document to public tracking clients.

Each item snapshot includes:
- product/variant/option IDs;
- names and labels at order time;
- selected selling option and quantity;
- physical stock form(s) consumed;
- stock conversion applied;
- price rule/tier IDs and pricing calculation snapshot;
- unit price/effective unit price, discount, line total.

#### `orderTracking/{trackingTokenHash}`

Minimal public tracking projection:
- order reference;
- customer-safe tracking code;
- public status;
- status timestamps;
- customer-safe delivery progress;
- last updated time.

No private address, phone, payment references, staff notes, rider details, or full order line data unless explicitly approved as customer-safe.

#### `customers/{customerId}`

Optional account-owned record:
- auth UID;
- customer-controlled contact/profile fields;
- timestamps and preferences.

Account creation is optional. Guest checkout must not require a customer document. Registered customers may see only their own profile and order history.

### Payments and delivery

Keep payment and fulfilment states separate.

- `orders/{orderId}/payments/{paymentId}`: private payment ledger.
- `deliveries/{deliveryId}`: private delivery operations.
- `deliveryTracking/{tokenHash}`: minimal public delivery projection if needed.

Do not expose full delivery documents through public tracking.

### Admin and governance

- `adminUsers/{uid}`: role and active status; server-managed.
- `auditLogs/{logId}`: append-only record of sensitive changes and actions.
- `settingsPublic/{settingId}`: public-safe storefront settings.
- `settingsPrivate/{settingId}`: private operational settings.

Do not rely solely on a hard-coded email check as the long-term authorization model. Bootstrap the initial owner/admin securely, then use explicit roles and server-side authorization.

## 4. Access matrix

| Resource/action | Public visitor | Signed-in customer | Staff/admin |
|---|---|---|---|
| Published products and variants | Read | Read | Manage by permission |
| Public prices and quantity offers | Read | Read | Manage by permission |
| Private costs/margins/supplier terms | No | No | Authorized roles only |
| Inventory balances and movements | No | No | Inventory roles |
| Place order | Trusted endpoint only | Trusted endpoint only | Admin-assisted endpoint |
| Read full order | No | Own orders only | Order roles |
| Public tracking | Minimal projection by valid token | Same | Full operational view |
| Customer profile | No | Own profile | Limited support access |
| Payments | No | Safe own payment status only | Payment roles |
| Delivery operations | No | Minimal customer-safe progress | Delivery roles |
| Catalogue publication | No | No | Catalogue roles |
| Pricing configuration | No | No | Pricing roles |
| Roles and permissions | No | No | Owner/admin only |
| Audit logs | No | No | Owner/admin and designated auditors |

All customer-facing reads must be limited to public-safe documents. A random document ID is not an authorization mechanism.

## 5. Initial role model

Implement only the roles needed for the current business, but keep permissions explicit:
- `owner`: all business configuration and access management.
- `catalogue_manager`: products, variants, images, selling options, publication.
- `pricing_manager`: retail prices, quantity tiers, promotions.
- `inventory_manager`: balances, receipts, break-pack, adjustments, stock counts.
- `order_manager`: order review, confirmation, cancellation, fulfilment.
- `payment_manager`: payment records and reconciliation.
- `delivery_manager`: delivery assignment and progress.
- `report_viewer`: permitted read-only operational reports.

One person may hold multiple roles. The first release can map the current administrator to owner while the role model is established.

## 6. Trusted backend boundaries

Use Firebase Cloud Functions or another trusted server runtime for:
- `createOrder`: validate request, read current catalogue and pricing config, calculate eligible tier, validate stock, perform break-pack if needed, reserve/deduct stock, create private order and tracking projection.
- `updateOrderStatus`: validate permitted state transition and perform stock release/restoration rules.
- `receivePurchase`: record goods receipt and update the correct inventory form.
- `adjustInventory`: require role, reason, and audit record.
- `publishProduct` / `publishPricing`: validate and produce public-safe projections.
- `adminUpdatePriceRules`: validate tier overlaps, dates, prices, and permissions.

Firestore rules must deny direct public order creation and all client-side stock mutations once the trusted endpoints are deployed and legacy checkout is migrated.

Do not tighten existing public order/delivery reads until a replacement tracking projection and compatibility plan are deployed and verified. The current rules are known to expose full order/delivery documents; this is a migration risk, not an acceptable target state.

## 7. Migration and rollout strategy

No live Firestore data should be rewritten in place as part of the first schema implementation.

1. Inventory current collections and representative document shapes from an authorized export or emulator fixture.
2. Define mapping from legacy product variants and embedded stock fields to stable variant, selling-option, inventory-form, and balance records.
3. Build an idempotent dry-run migration tool that reports missing IDs, ambiguous variants, invalid prices, missing package conversions, negative quantities, and duplicate SKUs.
4. Resolve product-specific unit and packaging configurations with the business before importing them. Never infer carton contents from names such as `X 48`.
5. Migrate to a staging Firebase project or emulator fixture first.
6. Compare old and new catalogue counts, stock totals by physical form, purchase history, and open-order balances.
7. Keep an export/backup and rollback plan before any production cutover.
8. Switch storefront reads and trusted checkout only after reconciliation and acceptance tests.
9. Replace public full-order/full-delivery tracking reads with minimal tracking projections only after compatibility tests pass.
10. Keep the legacy system read-only or available for rollback until the new workflow is verified.

## 8. Launch scope versus future capability

### Required for first release
- one store location;
- public catalogue and public tier offers;
- guest checkout and optional customer accounts;
- multiple selling options per variant;
- sealed and loose inventory forms;
- automatic break-pack conversion;
- admin-configurable quantity tiers and cross-unit qualification;
- trusted pricing/order/inventory backend;
- order and payment/fulfilment separation;
- safe public tracking;
- admin audit trail for pricing and stock changes.

### Designed for later, not built now
- multiple stores/warehouses and inter-location transfers;
- retailer account approval or private negotiated price lists;
- supplier portal;
- marketplace sellers and settlement;
- complex loyalty, points, and customer-specific contracts.

## 9. Acceptance gates

Do not call the foundation ready until:
- a guest can see all public price tiers without signing in;
- a guest can place an order without an account;
- optional accounts can access only their own order history;
- quantity offers match the administrator's published configuration;
- a unit order can qualify for an enabled cross-unit tier without changing its physical selling option;
- a 6-piece sale from 10 sealed cartons of 48 results in 9 sealed cartons and 42 loose pieces;
- simultaneous orders cannot oversell stock;
- price, stock, and order totals are calculated on the trusted backend;
- public tracking reveals no private customer, payment, staff, or rider data;
- old orders and stock can be reconciled before cutover.
