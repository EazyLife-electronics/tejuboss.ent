# Tejuboss Product Units and Pricing Model

Status: Proposed foundation contract; multi-option selling confirmed by business
Working branch: `tejuboss-foundation`
Firebase project: `tejuboss-ent`

## 1. Purpose

Tejuboss products do not share one universal selling unit. Depending on the product, customers may buy by carton, roll, individual unit, pack, measured quantity, or another explicit unit. The catalogue must represent this directly.

The model must not infer a unit or conversion from a product name, description, SKU, image, or text such as `X 48`. Those fields are descriptive only. Unit and conversion data must be structured, validated, and maintained by an authorized administrator.

## 2. Three separate concepts

### Stock unit

The smallest practical inventory unit in which Tejuboss tracks available stock for a sellable variant.

Examples:
- `piece` for individually countable goods.
- `roll` where a complete roll is the inventory unit.
- `metre` where stock is measured and may be sold by length.
- `kilogram` or `litre` for weight- or volume-based goods.

A variant has one canonical stock unit at a given time. Changing it later requires a controlled stock conversion/migration, not a silent field edit.

### Selling unit

A customer-facing option available for an order line. Examples include `piece`, `carton`, `pack`, `roll`, or `metre`.

A product variant may expose multiple selling options where applicable. The business has confirmed that a customer may buy the same product as a carton, roll/pack, or individual unit, depending on that product's actual packaging and sale configuration. The storefront must therefore support multiple selectable options for one product/variant. Do not assume every product supports every option.

### Conversion

Each selling option defines how many stock units are consumed by one selling unit.

Examples:
- 1 piece = 1 piece of stock.
- 1 carton = 48 pieces of stock.
- 1 roll = 1 roll of stock.
- 1 metre = 1 metre of stock.

Conversion values must be explicit and positive. Decimal conversion is permitted only where the stock unit and business process support fractional quantities. Countable items should use whole-number quantities.

## 3. Proposed catalogue contract

Keep product identity and merchandising separate from the sellable variant and its commercial options.

### Product

Suggested public fields:
- `name`
- `brand`
- `categoryId`
- `description`
- `images[]`
- `published`
- `searchKeywords[]`
- timestamps

Do not expose cost price, supplier terms, internal stock movements, or private purchasing notes in public product documents.

### Product variant

Each independently stocked/identified option has a stable immutable ID and SKU.

Suggested fields:
- `id`
- `sku`
- `label` (human-readable attributes such as size, scent, colour, or specification)
- `stockUnit` (structured unit code and display label)
- `quantityPrecision` (0 for whole-number-only stock; a deliberate decimal precision for measured stock)
- `active`

Avoid using a human-readable label as the variant's identity. Orders must reference stable product and variant IDs.

### Selling options

Each variant has an explicit list of available selling options. Suggested fields:
- `id` (stable option ID)
- `unitCode` (for example `piece`, `carton`, `roll`, `metre`)
- `displayName` (for example `Piece`, `Carton of 48`, `Roll`)
- `stockUnitsPerSaleUnit` (conversion factor)
- `minimumOrderQuantity`
- `orderQuantityStep`
- `active`
- optional `packDescription` for customer-facing detail

The conversion factor is the authoritative inventory conversion. A label such as `Carton of 48` must agree with the structured conversion, but the label itself is never used for arithmetic.

Example only, for a variant whose stock unit is piece:
- Piece: conversion 1.
- Carton: conversion 48.

A roll-based variant may instead have:
- Roll: conversion 1, with stock unit roll.

Do not create a carton option for every product automatically. Only expose options that the business actually sells.

## 4. Retail, wholesale, and administrator-controlled quantity pricing

Wholesale pricing is required from the first release. It must not be deferred to a later phase.

Each selling option can have its own base retail price and wholesale/quantity-pricing rules. For example, the same variant may have different prices when sold as a piece, pack, roll, or carton.

### Pricing levels

The pricing engine must support independently configurable pricing at each applicable selling level:
- individual unit;
- pack;
- roll;
- carton;
- any additional configured selling option.

Each level can have its own qualifying quantity thresholds and resulting price, discount, or margin rule. Administrators may enable, disable, or configure these rules independently for each product/variant and selling option. There must be no hard-coded assumption that buying a pack or carton always earns a discount.

### Cross-unit quantity qualification

Where the administrator enables it, quantity qualification may compare equivalent quantities across selling forms using the explicit stock conversion values.

For example, if a pack contains 12 pieces, an order for 10 individual pieces may be evaluated against an administrator-configured pack-level quantity tier or equivalent quantity rule. The customer still receives 10 individual pieces; the system does not automatically convert the order into a pack plus loose pieces. Only the price eligibility is evaluated across the configured equivalent quantity.

The administrator must be able to decide:
- whether a selling level has bulk pricing at all;
- the minimum qualifying quantity for each tier;
- whether the threshold is measured in the selected selling unit or an explicitly configured equivalent/base quantity;
- which price or discount/margin rule applies;
- whether a tier may be earned by quantities ordered in another selling form;
- whether the rule applies to retail customers, wholesale customers, or both;
- whether the rule stacks with promotions or other discounts (default should be no stacking unless explicitly enabled).

A product can therefore have no discount on individual-unit sales, even when a large number of units is purchased, while pack or carton sales may have separate wholesale tiers. This is an intentional commercial decision, not a system error.

### Price calculation and governance

The pricing engine must select the best valid rule only within the administrator-defined eligible rules. It must not invent a discount, infer a wholesale rate, or automatically choose a cheaper package price simply because quantities are mathematically equivalent.

A price record/rule must identify:
- product and variant;
- selling option or explicitly defined cross-option scope;
- customer class/price list (retail or wholesale);
- qualifying quantity and quantity basis;
- price or discount/margin method;
- currency;
- effective start/end dates where applicable;
- enabled status and stacking policy.

Administrators should be able to preview/test a pricing rule against sample quantities before publishing it. All rule changes must be audited with actor, timestamp, and before/after values.

Store monetary values as integer minor units (kobo for NGN) in trusted backend records. Never trust a browser-submitted unit price, discount, subtotal, delivery charge, or order total. The backend must calculate the applicable price from current trusted catalogue and pricing rules at order time.

For launch, all applicable retail and quantity-tier prices are public. No account, login, retailer approval, or customer registration is required to view or qualify for an advertised quantity offer. The storefront should present the current unit price and clearly show quantity incentives beside it, such as "Buy 2 or more: ₦X each" or "Buy 6+: save Y%". This is an upsell mechanism intended to encourage customers to add more to their basket, not a private wholesale-gated price list.

A customer may optionally create an account to retain their own details and view their order history. Guest checkout remains available, and account creation must not be a prerequisite for seeing prices, receiving an eligible quantity price, or placing an order. The backend must apply the same published eligibility rules to guest and registered customers unless a future, explicitly approved customer-specific programme is introduced.

The customer-facing price presentation must make the threshold and benefit understandable before checkout. The cart and checkout must recalculate the qualifying tier using the complete eligible basket/order quantity and show the applied unit price, savings, and threshold. The server remains authoritative for the final calculation.

## 5. Inventory and order arithmetic

Inventory is held in stock units, not in a mixture of carton counts, roll counts, and customer-facing labels.

For every order line:

`stockUnitsRequired = orderedQuantity × stockUnitsPerSaleUnit`

The backend must validate:
1. The product and variant exist and are active.
2. The selling option belongs to that exact variant and is active.
3. The ordered quantity satisfies the option's minimum and step.
4. The conversion result is valid at the stock unit's precision.
5. Sufficient available stock exists at the chosen fulfilment location.
6. The applicable price list and promotion are valid at order time.

The backend then calculates the line amount and order totals from current trusted data, and deducts or reserves the correct stock quantity transactionally.

Order lines should preserve an immutable commercial snapshot:
- product and variant IDs;
- product name and variant label at order time;
- selling option ID, unit code, and display name at order time;
- ordered quantity;
- conversion factor applied;
- stock units consumed;
- unit price and currency;
- discount details;
- calculated line total.

This snapshot preserves the meaning of historical orders if an administrator later renames a product or changes a pack configuration. Historical order arithmetic must never be recalculated from today's product setup.

## 6. Inventory: sealed packages and loose stock

The business has confirmed that unopened packages and loose stock are counted separately. The inventory model must preserve that distinction. A single flattened quantity in the smallest unit would lose important operational information.

For a product that can be sold as cartons and individual pieces, inventory may include:
- unopened cartons, counted as whole cartons;
- loose pieces, counted as individual pieces;
- unopened packs/rolls where these are independently stocked and sold.

Where a carton contains 48 pieces, 1 unopened carton and 48 loose pieces are not interchangeable inventory records. They may represent the same theoretical quantity, but their packaging state is operationally different.

### Proposed inventory balance

Track stock by location, product variant, and inventory form. Each form has a configured conversion into a canonical base quantity for reporting and reconciliation. The system must not silently combine balances or treat loose pieces as sealed cartons.

### Selling and fulfilment rules

Each selling option identifies the inventory form(s) it can consume:
- Carton order consumes sealed-carton stock.
- Individual-piece order consumes loose-piece stock.
- Pack or roll order consumes the matching sealed pack/roll stock when that is how the business tracks it.
- If the business explicitly configures a pack to be assembled from loose units, that is a separate packing workflow and must be recorded.

The business has confirmed the automatic break-pack rule: when loose stock is insufficient for an individual-unit sale, the system opens the required number of sealed cartons, transfers their contents into loose stock, and fulfils the order from that loose balance.

Example: with 10 sealed cartons of 48 units and no loose units, a sale of 6 units results in 9 sealed cartons and 42 loose units.

This conversion and sale must be one atomic backend transaction. The system must:
1. calculate the loose-stock shortfall;
2. calculate the whole number of sealed cartons required to cover the shortfall;
3. reduce sealed-carton stock by that number;
4. increase loose stock by the configured contents of those cartons;
5. deduct the ordered loose quantity;
6. write linked stock-movement records for the break-pack conversion and sale;
7. record actor/system source, timestamp, location, reason, package configuration, and before/after balances.

The transaction must fail safely if there is insufficient eligible stock, if the package conversion is invalid, or if concurrent orders have already consumed the stock. It must not leave a partial conversion or partial deduction.

The same principle applies to any other package form only where the administrator has configured a valid conversion and the business permits that conversion. Do not assume that a carton, pack, and roll can be opened or converted in the same way.

Available-to-sell quantities must be calculated per selling option and its eligible inventory forms. A general total-stock figure may be shown internally for reporting, but it must not be used as the sole checkout availability check.

## 7. Purchasing and receiving

Purchases must record the unit in which goods were received and the conversion into the appropriate inventory form.

For example, receiving 10 sealed cartons of 48 pieces adds 10 to the sealed-carton balance, not 480 to the loose-piece balance. If goods are received as loose pieces, they increase the loose-piece balance. Receiving 10 rolls increases the roll balance if roll is the tracked form.

The goods receipt must preserve:
- supplier's purchase unit;
- received quantity;
- conversion/package configuration used;
- inventory form increased;
- base-equivalent quantity for reporting where meaningful;
- cost and currency;
- receiving location;
- source purchase/order reference.

Do not assume that supplier purchase units always match customer selling units.

## 8. Location-aware stock readiness

The business has confirmed that it currently operates one store, and the initial online-order fulfilment model will use that single stock location. Implement one active fulfilment location for launch, while keeping location IDs in the inventory contract so additional outlets or warehouses can be introduced later without redesigning stock records. Do not build multi-location transfer and fulfilment workflows into the first release unless the business requirement changes.

The inventory data contract should be keyed by:
- location ID;
- product variant ID;
- stock/packaging form ID;
- on-hand quantity;
- reserved quantity;
- reorder threshold.

Available quantity is derived from on-hand less reserved stock within the same inventory form. Do not maintain multiple independently editable copies of the same stock balance.

A multi-location rollout requires an explicit fulfilment policy, transfers, receiving and reconciliation workflows. It should not be implied by merely adding a location field.

## 9. Validation and administration safeguards

- Unit codes should come from a controlled list, with support for business-specific labels where necessary.
- Every variant must have exactly one stock unit.
- Every active selling option must have a positive conversion factor.
- Countable stock must reject fractional deductions.
- Measured stock may allow decimals only to its configured precision.
- A selling option referenced by historical orders must be archived, not destructively removed.
- Changing a conversion factor after transactions exist must require an audited correction/migration workflow.
- Cost price and supplier data remain admin-only.
- Public catalogue documents must contain only fields intended for public display.
- All stock and price changes should record actor, timestamp, reason, and before/after values in an audit trail.

## 10. Illustrative examples

These examples explain the structure only. They are not statements about Tejuboss's actual product configurations.

| Example product type | Stock unit | Selling option | Conversion |
|---|---|---|---:|
| Individually sold item | piece | Piece | 1 |
| Carton containing 48 pieces | piece | Carton | 48 |
| Product sold by roll | roll | Roll | 1 |
| Material sold by measured length | metre | Metre | 1 |

A single piece/carton product may expose both Piece and Carton options. A roll product need not expose any other option unless Tejuboss actually sells it in another form.

## 11. Confirmed business requirements and remaining decisions

**Confirmed business requirements:**
1. The same product may have multiple selling options, including carton, pack, roll, and individual unit where applicable.
2. Each selling option has an explicit conversion and its own price.
3. Unopened packages and loose stock are tracked separately.
4. When loose stock is insufficient for a unit sale, the system automatically opens the required carton(s), transfers the contents to loose stock, and fulfils the sale in one atomic transaction.
5. Initial fulfilment uses one store/inventory location.
6. Wholesale and quantity-based pricing must be available from the first release.
7. Bulk qualification and price reductions are independently controlled by the administrator at each selling level. Cross-unit equivalent-quantity qualification is possible only when explicitly enabled.
8. Pricing eligibility does not change the physical selling form selected by the customer. A unit order remains a unit order even if it qualifies for a pack-level pricing rule.

**Confirmed customer access:** All advertised quantity/wholesale tiers are public. No customer account or approval is required to view or qualify. Guest checkout is supported. Account creation is optional and exists only to help customers retain their details and order history. Public quantity offers are an upsell strategy: show the current price and the next qualifying quantity/price clearly, so customers are encouraged to add more.

