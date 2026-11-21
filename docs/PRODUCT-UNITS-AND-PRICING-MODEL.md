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

## 4. Pricing contract

Prices belong to a specific selling option, not merely to the product name. The same variant may have different prices for piece, pack, carton, or roll.

The model should support:
- public retail price;
- wholesale or retailer price;
- customer-group or approved-account price lists in a later phase;
- time-bounded promotions;
- quantity breaks where the business explicitly enables them.

A price record must identify the product variant, selling option, price list/customer group, currency, amount, and effective period where applicable.

Store monetary values as integer minor units (kobo for NGN) in trusted backend records. Format them for display in the client. Never trust a browser-submitted unit price, discount, subtotal, delivery charge, or order total.

For the initial retail launch, the public retail price is the default price list. Wholesale price lists and negotiated account pricing can be added without changing the unit conversion contract.

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
- loose pieces, counted as individual pieces.

Where a carton contains 48 pieces, 1 unopened carton and 48 loose pieces are not interchangeable inventory records. They may represent the same theoretical quantity, but their packaging state is operationally different.

### Proposed inventory balance

Track stock by location, product variant, and stock/packaging form. For example:
- sealed carton balance: quantity in cartons;
- loose balance: quantity in pieces;
- sealed pack balance: quantity in packs, if packs are separately stocked and sold.

Each package form must have a configured conversion into a canonical base quantity for reporting and reconciliation, but the system must not silently combine balances or treat loose pieces as sealed cartons.

### Selling and fulfilment rules

A selling option must specify which inventory form(s) it can consume:
- Carton order consumes sealed-carton stock.
- Individual-piece order consumes loose-piece stock by default.
- Pack order consumes sealed-pack stock if the business keeps packs separately; otherwise it may consume loose stock only under an explicitly configured packing workflow.

If the business permits staff to open a carton to fulfil a piece/pack order, this must be a recorded stock conversion transaction:
1. reduce sealed carton quantity by the number opened;
2. increase loose quantity by the configured contents of those cartons;
3. record actor, timestamp, location, reason, package configuration, and before/after balances;
4. then fulfil the piece/pack order from the resulting loose/pack balance.

Do not silently convert sealed stock into loose stock during checkout. The initial launch can reject/hold an order when the requested form is unavailable, or use a clearly authorized and recorded break-pack workflow if the business approves it.

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

The first retail launch may use one fulfilment location if that reflects current operations. The data contract should nevertheless allow inventory to be keyed by:
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

## 11. Confirmed business requirement and decisions still required

**Confirmed:** The same product can be offered to customers in more than one selling form. Depending on the product, a customer may choose carton, roll/pack, or individual unit. The storefront and order model must support multiple active selling options per product variant, each with its own price and stock conversion.

The following operational choices remain open and must not be guessed:

1. **Stock handling:** Is stock currently counted in the smallest practical unit (for example, pieces inside cartons), or does the store count unopened cartons/rolls as whole units? This determines whether a carton conversion can be applied directly to a piece-based stock balance or whether stock must support whole unopened packages and loose quantities.
2. **Fulfilment locations:** Will online orders initially be fulfilled from one store/warehouse, or can staff choose among multiple outlets?
3. **Retail and wholesale launch:** Should the first release show retail prices only, while wholesale pricing is administered later, or must wholesale prices be supported at launch?

These answers determine the first implementation scope. They do not change the core principle that stock unit, selling unit, conversion, and price are separate structured values.
