# Phone-first inventory overview and physical count adjustments

The foundation branch now includes a private callable inventory overview and a physical-count adjustment workflow for authorized staff.

## Inventory overview

The listInventorySetup callable requires an authenticated owner, inventory_manager, or order_manager role and App Check. It returns a bounded set of inventory forms and recent balances. It returns only the fields needed for stock operations; it does not expose supplier costs, customer records, or private pricing.

The admin Stock Setup screen displays current quantities and stable balance/form IDs. The view is limited to 500 balances and 300 forms per request; the response indicates when either limit is reached.

## Physical count adjustment

The adjustInventoryPhysicalCount callable requires an authenticated owner or inventory_manager role and App Check. The caller must provide the stable balance ID, the quantity last loaded by the admin screen, a new non-negative whole-number physical count, a reason, and explicit physical-count confirmation.

The transaction rejects stale quantities, preventing an older phone screen from overwriting a more recent sale or adjustment. It also rejects a count below reserved quantity. A successful non-zero adjustment updates the balance, creates an immutable inventory movement and writes an audit record in the same transaction. An unchanged count creates no movement.

## Important boundaries

- This is not a stock-opening shortcut. Existing balances must be adjusted, never reinitialized.
- Never use an estimated quantity as a physical count.
- The callable does not deduct stock for an order. Order confirmation remains the only order-fulfilment path that deducts stock.
- The callable and UI are committed to tejuboss-foundation; no Firebase deployment or live stock mutation has occurred.
- App Check and Firebase role claims must be configured before the secured admin actions can be used.
