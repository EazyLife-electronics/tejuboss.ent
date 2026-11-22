# Order Confirmation and Grocery Inventory

Status: Business policy accepted; emulator adapter and tests implemented. Production callable integration and inventory initialization remain pending.

## Approved order lifecycle

- Customer submits an order: status is `awaiting_confirmation`.
- Order submission does not reserve or deduct inventory.
- Staff confirms: the backend rechecks current inventory and deducts stock atomically with the order status change.
- Staff rejects: status becomes `rejected`; inventory is untouched.
- A repeated confirmation is idempotent and cannot deduct stock twice.
- If stock is insufficient when staff confirms, the transaction fails without changing the order or inventory. Staff may then reject or contact the customer.
- Payment status and fulfilment status remain separate from order status.

## Recommended grocery inventory model

Use integer quantities in the smallest controlled stock unit where possible. For measured goods, define explicit decimal precision and a separate precision-aware stock planner. Do not use the whole-piece planner for fractional kilograms, litres or metres.

Inventory is location-scoped even though Tejuboss starts with one launch location. Recommended records:

- `inventoryBalances/{balanceId}`: productId, variantId, locationId, inventoryFormId, stockUnitCode, quantityOnHand, quantityReserved (initially zero/not used), updatedAt, updatedBy.
- `inventoryForms/{formId}`: stable form ID, customer/internal label, stock unit, unitsPerPackage, canBreakPackage, active.
- `inventoryMovements/{movementId}`: immutable movement type, product/variant/location/form IDs, quantity, before/after balance, order or receiving reference, actor, timestamp, reason.
- `inventoryLots/{lotId}`: product/variant/location, received quantity, remaining quantity, batch/lot number, received date, expiry date, supplier reference. Use FEFO (first expiry, first out) for goods with expiry dates.

Suggested movement types: `receiving`, `sale`, `break_pack`, `return`, `waste`, `damage`, `expiry`, `count_adjustment`, `transfer_in`, `transfer_out`.

## Package handling

Keep sealed packages and loose stock as distinct inventory forms. A selling option may consume a sealed package directly or loose units only when its configuration explicitly permits it. Breaking a package transfers stock between forms and is recorded separately from the sale, within the same confirmation transaction.

Example: 10 sealed cartons × 48 pieces, 0 loose pieces. Confirm a 6-piece order: 1 carton is opened, 6 pieces sold, resulting balance 9 sealed cartons and 42 loose pieces.

## Operational safeguards

- Test products and balances must be seeded only in emulator fixtures or an isolated development database.
- No inventory initialization or stock count should be guessed from product labels.
- Staff confirmation requires a verified server-side role. Firebase login alone is not authorization.
- Confirmations must be serialized by Firestore transaction contention; two orders cannot both consume the same last stock.
- A pending order is not a stock guarantee. The customer-facing message must state that confirmation is pending.
- No live inventory or order cutover until an authorized admin role, stock opening-balance workflow, and approved delivery policy are ready.
