# Grocery Inventory and Order Confirmation Defaults

Status: Recommended development baseline approved by the business owner on 2026-11-22.
Branch: `tejuboss-foundation`
Production impact: none; this is a design and test baseline.

## Confirmed business policy

- Tejuboss sells groceries.
- Use representative sample products for development and emulator tests.
- Deduct inventory only when an authorized staff member confirms an order.
- Submitting a customer order creates an `awaiting_confirmation` order and does not change inventory.
- Confirmation must atomically validate current stock, deduct it, append inventory movements, and change the order to `confirmed`.
- Rejection/cancellation before confirmation does not deduct stock.
- A repeated confirmation must not deduct stock twice.
- Payment, fulfilment and delivery statuses remain separate from order confirmation.

## Recommended grocery inventory model

Use a transaction ledger with current balances, rather than editing a single product stock number without history.

### Product and sellable option

A catalogue product/variant contains:
- stable product, variant and selling-option IDs;
- base stock unit (e.g. each, kg, litre);
- sellable unit (e.g. each, 500 g pack, 1 kg pack, crate);
- explicit conversion to base units, stored as an integer or fixed-precision decimal;
- minimum quantity and order step;
- whether the option is stock-controlled and active.

Do not infer pack contents from names. A 1 kg pack must have an explicit 1,000 g conversion if grams are the inventory base.

### Inventory balance

Recommended document shape (illustrative only; paths/IDs will be finalized in the adapter):

`inventoryBalances/{locationId}__{productId}__{variantId}__{stockFormId}`

Fields:
- `schemaVersion`
- `locationId`, `productId`, `variantId`, `stockFormId`
- `stockUnitCode`
- `quantityOnHand` (integer in the smallest configured unit)
- `quantityReserved` (initially zero/not used while policy is confirmation-time deduction)
- `updatedAt`, `updatedBy`

For sealed grocery cases, keep sealed case count and loose/base units separate when the business explicitly permits opening cases. The case-to-unit conversion must be configured, not guessed.

### Append-only inventory movement

Each stock change writes a ledger entry:
- movement ID and idempotency/source reference;
- movement type: `opening_balance`, `purchase_receipt`, `sale_confirmation`, `break_pack`, `waste`, `expiry`, `damage`, `stock_count_adjustment`, or `return`;
- product/variant/location/stock form;
- quantity and unit;
- balance before and after;
- reason, actor and server timestamp;
- linked order or receiving document where applicable.

The balance update and movement record must be committed together in a Firestore transaction. Never allow the browser to create or edit movement records.

## Grocery-specific safeguards

- Track lot/batch and expiry date for perishables where practical.
- Use FEFO (first-expiry, first-out) when selecting dated lots; FIFO is the fallback for non-expiring goods.
- Stock receipt, waste, damage, expiry and physical-count corrections need distinct audited movement types.
- For weight/volume goods, use explicit fixed precision and a dedicated planner. Do not use the whole-piece carton planner.
- A confirmation fails safely if stock is insufficient at that moment. The staff member can adjust/reject the order; pending orders do not silently reserve stock under the confirmed policy.

## Sample test catalogue

Use non-production fixtures such as:
- Rice, 1 kg bag and 5 kg bag (explicit 1,000 g / 5,000 g base conversions);
- Eggs, single egg and crate of 30 (explicit conversion);
- Cooking oil, 1 litre bottle;
- Tomato paste, single tin and carton;
- Beans, 500 g and 1 kg packs.

Use clearly labelled sample prices and stock quantities only in emulator fixtures. Do not import or publish these as real store inventory.

## Delivery setup recommendation

Because no delivery policy has been supplied yet, use a configurable policy, not hard-coded customer promises:
- customer chooses delivery or pickup;
- delivery areas/zones are admin-configured and enabled individually;
- default development calculation: one flat fee per order, with an optional area surcharge;
- pickup fee is zero;
- delivery fees are snapshotted on the confirmed order;
- no automatic discounts, distance estimates, or delivery-time promises until the business configures them.

This is a recommendation for the implementation shape, not a claim that Tejuboss has selected live delivery prices or areas.

## Implementation boundary

This model does not initialize real stock, set real prices, activate delivery zones, deploy functions/rules, or enable checkout. The confirmation transaction must be emulator-tested for concurrency, repeated confirmation, insufficient stock, and atomic ledger writes before deployment.
