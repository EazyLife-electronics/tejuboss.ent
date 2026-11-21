# Tejuboss Pricing Engine and Checkout Workflow

Status: Proposed implementation contract based on confirmed business decisions
Working branch: `tejuboss-foundation`
Firebase project: `tejuboss-ent`

## 1. Commercial intent

Tejuboss uses public quantity offers as an upsell strategy. The storefront should show customers how buying a larger quantity can reduce the effective price, encouraging them to add more to their basket.

This is not a login-gated wholesale programme:
- every visitor can see published prices and quantity offers;
- no account or approval is required to qualify;
- guest checkout is always available;
- accounts are optional and help customers retain details and order history.

The system must never assume that larger quantities automatically deserve a discount. Administrators decide whether a product has quantity offers, which selling levels participate, the qualification rules, and the price calculation.

## 2. Separate qualification from price calculation

Every quantity tier has two independent questions:

1. **Eligibility:** What quantity qualifies, and how is it measured?
2. **Price method:** Once qualified, how is the order amount calculated?

Keeping these separate prevents the engine from assuming that a pack price should automatically replace a unit price.

## 3. Quantity qualification bases

Each tier explicitly selects one qualification basis:

- `selected_option_quantity`: count only the selected selling option. Example: buy 3 cartons.
- `base_stock_quantity`: convert the selected quantity into the variant's canonical equivalent quantity. Example: buy 24 pieces, regardless of whether the customer selected pieces or packs.
- `cross_option_equivalent_quantity`: aggregate equivalent quantities across configured selling options for the same product variant. Example: 1 pack plus 4 individual pieces may qualify as 10 equivalent pieces if the pack conversion and tier configuration say so.

Cross-option aggregation is not automatic. The administrator must enable it and choose its scope. By default, quantities from different product variants do not combine.

## 4. Supported price methods

Each tier selects one explicit calculation method. The first release should support these methods:

### A. Fixed effective unit price

Once qualified, apply a configured effective price per base unit to the eligible quantity.

Example: 10 pieces qualify for a configured ₦850 per-piece rate. The order remains 10 individual pieces; the pricing engine calculates 10 × ₦850.

### B. Percentage or fixed-amount reduction

Apply the configured reduction to the eligible price basis. The administrator chooses the percentage or amount and the basis to which it applies. Validate that the resulting price cannot be negative.

### C. Blended package-equivalent price

This supports the specific upsell strategy where an order in one selling form may be priced as a combination of a larger package price and the remainder at the smaller-unit price, without changing what the customer physically ordered.

Example only:
- pack contains 6 pieces;
- pack price is ₦5,000;
- single-piece price is ₦1,000;
- customer orders 10 individual pieces;
- admin enables the pack-equivalent blended tier.

The engine calculates:
- 1 pack equivalent: ₦5,000;
- remaining 4 pieces: 4 × ₦1,000 = ₦4,000;
- blended total: ₦9,000;
- average effective price: ₦900 per piece.

The customer receives 10 individual pieces, not one physical pack plus four pieces. The pricing calculation uses the package price as a reference only.

General formula:

`packageCount = floor(eligibleBaseQuantity / packageBaseQuantity)`

`remainder = eligibleBaseQuantity % packageBaseQuantity`

`tierTotal = packageCount × referencePackagePrice + remainder × remainderUnitPrice`

This method can reference a pack or carton, but only if the administrator explicitly configures that reference option and its conversion. It must not assume that every product has a pack or carton.

## 5. Admin tier configuration

Each tier should store:
- `tierId`
- `enabled`
- `customerClass` (public retail, public quantity offer; future classes may be added)
- `qualificationBasis`
- `minimumQuantity`
- optional `maximumQuantity`
- `eligibleSellingOptionIds[]`
- `aggregateAcrossOptions`
- `priceMethod`
- method-specific values (fixed unit price, percentage, fixed amount, or reference package option)
- `priority` where explicitly needed
- `startsAt`, `endsAt`
- `stackingPolicy`
- `publicLabel` and `publicTerms`
- audit metadata

The administrator can independently enable or disable quantity tiers for unit, pack, roll, carton, and any other selling option. A product may have:
- no unit discount;
- a pack quantity tier;
- a carton quantity tier;
- a cross-option tier that evaluates unit quantity against a pack/carton reference;
- or any other explicitly configured combination.

The admin editor must not force all levels to have a discount.

## 6. Tier selection and conflict handling

The trusted pricing engine must:
1. load the active product/variant and selected selling option;
2. derive eligible quantities using only configured conversions;
3. find tiers whose customer class, selected options, quantity basis, dates, and enabled state match;
4. apply only tiers explicitly eligible for that order;
5. resolve overlapping tiers using the configured priority and deterministic threshold ordering;
6. calculate the price using the selected method;
7. enforce configured stacking rules;
8. return a detailed price explanation for the cart and order snapshot.

Do not silently select a lower package price or a discount tier merely because the quantity is numerically equivalent. Do not combine different variants unless a future rule explicitly allows it.

If two active rules conflict at the same priority and same qualification range, reject publication or require the administrator to resolve the conflict. Do not make a guess at checkout.

## 7. Customer-facing storefront behaviour

On the product page and in product cards where space permits:
- show the normal current price;
- show published quantity thresholds and their effective prices/savings;
- identify the qualifying quantity and unit clearly;
- indicate when a tier can be earned by equivalent quantities across options;
- show the next threshold and how much more the customer needs to add;
- avoid showing private margin or cost information.

For a blended package-equivalent tier, explain the effective price clearly, for example: "10 pieces qualify for pack-equivalent pricing; average ₦900 per piece." The selected selling option and physical quantity must remain visible.

The cart must:
- recompute eligible quantities across configured lines;
- show the applied tier and calculation;
- show savings against the configured comparison price;
- update the next-tier prompt as quantities change;
- make clear when removing an item will cause a tier to be lost.

The checkout must show the final item totals, tier savings, delivery, and total before order submission.

## 8. Trusted order calculation

The browser may calculate an estimate for responsiveness, but the backend is authoritative.

At submission, the client sends only:
- product ID;
- variant ID;
- selling option ID;
- quantity;
- customer and fulfilment details;
- optional account UID/token if signed in;
- idempotency key.

The client must not submit authoritative prices, discounts, stock conversions, or totals.

The trusted backend:
1. validates request shape and idempotency;
2. loads current published product/variant/option and private pricing rules;
3. recalculates all quantity tiers using the submitted basket and configured aggregation rules;
4. validates prices and effective dates;
5. validates stock in the eligible inventory forms;
6. performs any required break-pack conversion and stock reservation/deduction atomically;
7. creates the order with a complete immutable pricing snapshot;
8. creates a minimal public tracking projection;
9. returns the order reference and customer-safe tracking information.

If price or stock changed between the customer's preview and submission, return a clear repricing/availability response and let the customer confirm the updated basket. Do not silently charge a different amount.

## 9. Required order pricing snapshot

For each line, preserve:
- selected selling option and ordered quantity;
- equivalent/base quantity used for tier qualification;
- eligible tier ID and public label;
- qualification basis and threshold reached;
- price method;
- reference package option and conversion, if blended;
- base price;
- effective unit price where meaningful;
- line subtotal;
- tier discount/savings;
- final line total.

At order level preserve:
- pricing configuration version or revision;
- currency;
- subtotal;
- total quantity-tier savings;
- other discounts;
- delivery charge;
- grand total;
- calculation timestamp.

Historical orders must remain unchanged if an administrator edits prices, package sizes, or quantity tiers later.

## 10. Payment and fulfilment separation

Pricing and stock confirmation do not imply that payment has been received. Preserve separate states:
- order/fulfilment status;
- payment status.

The business may choose cash on delivery, transfer, or other payment methods. Each payment event must be recorded separately and reconciled by authorized staff. Do not mark an order paid merely because it was submitted.

## 11. Acceptance scenarios

Use automated tests for at least these scenarios:

1. Visitor sees all published quantity offers without signing in.
2. Guest places an order without creating an account.
3. Registered customer receives the same public offer as a guest.
4. Unit tier is disabled: a large unit quantity receives no unit discount unless another explicitly enabled cross-option tier applies.
5. Pack tier is enabled: configured pack quantity earns the configured pack tier.
6. Cross-option qualification is enabled: unit quantity can qualify against pack/carton equivalence.
7. Blended example: pack of 6 at ₦5,000, unit at ₦1,000, 10 individual pieces produce ₦9,000 total and remain 10 individual pieces.
8. Cross-option qualification disabled: the same basket does not qualify.
9. Different product variants do not combine toward a tier by default.
10. Conflicting active tiers are rejected at publication or resolved only by explicit priority.
11. Client-tampered price and total values are ignored.
12. Price changes between preview and submission produce a repricing response.
13. Repeated submission with the same idempotency key does not create duplicate orders or duplicate stock deductions.
14. Order snapshots remain stable after admin changes the live price rules.


## 12. Quantity-tier engine implementation status

The pure domain engine now supports two explicit modes:

- `threshold`: when a threshold is reached, the configured rate applies to all eligible quantity.
- `marginal`: each contiguous quantity band is priced at its own configured rate.

It supports two explicit qualification bases:

- `selected_option_quantity`: a rule targets exactly one selling-option ID, allowing unit, pack, roll, or carton tiers to be configured independently.
- `base_stock_quantity`: a rule qualifies using explicit stock-unit equivalents and can target multiple selling options when cross-option aggregation is enabled.

For selected-option rules, rates are configured per selling option. For base-stock rules, rates are configured per stock unit. The engine rejects malformed tier schedules, missing rates, invalid quantity bands, and a tier result that would exceed the configured base price.

The engine is currently a pure, tested calculation module. It is not yet wired into the live cart or order transaction. That integration must preserve a server-generated price snapshot and must use the same configured rule revision for quote and final order calculation.

**Business confirmation still required before enabling any rule:** choose whether the initial Tejuboss offers should use threshold or marginal behaviour. Both are implemented, neither is silently selected as the default. The administrator's future product editor should require an explicit mode per published tier rule.


## 13. Quantity-tier checkout integration

The pure tier engine is now connected to the trusted checkout quote composer through `applyQuantityTierRules`.

- Checkout accepts tier rules only as a separate trusted backend argument; the public order request schema does not accept or trust tier definitions.
- Rules are scoped to a trusted product document ID and variant ID.
- Selected-option qualification aggregates only the exact eligible selling option.
- Base-stock qualification uses each catalogue line's explicit `stockUnitsPerSaleUnit` conversion.
- Cross-option aggregation is rejected unless the rule explicitly enables it.
- Multiple enabled rules cannot target the same checkout line.
- Catalogue promotional prices and quantity tiers do not stack. Promotional lines are excluded from tier qualification.
- Basket-level discounts are allocated to order lines deterministically, with exact integer-minor-unit reconciliation.
- The final merchandise subtotal, discount and total are recalculated before delivery is calculated.

The quote composer returns the applied rule/tier identifiers and qualification quantity so the final order can preserve an auditable pricing snapshot.

This is quote-layer integration only. The production transaction must read the authoritative tier configuration inside the same transaction as catalogue and inventory, then snapshot the exact rule revision and applied tier results. The Firestore transaction harness has not yet been changed to use tier configuration.
