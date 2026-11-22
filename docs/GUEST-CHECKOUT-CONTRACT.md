# Guest Checkout Request and Trusted Quote Contract

Status: Implemented, tested and connected to the additive structured storefront preview. Not deployed to Firebase.

## Request contract

The callable accepts only:
- idempotency key;
- product, variant and selling-option IDs plus quantity per line;
- customer name and phone, optional email;
- pickup or delivery selection, with address and configured area for delivery;
- optional customer note.

The backend rejects browser prices, discounts, stock quantities, delivery fees, subtotals, totals and unknown fields. The guest does not need a customer account.

## Trusted calculation

At order creation, the backend reads the current published product, authoritative pricing configuration, inventory mapping and (for delivery) active delivery policy. It calculates line pricing, eligible quantity-tier rules, delivery charge and final total in integer minor units. Browser totals are estimates only and are not accepted as authority.

If the selected product, price configuration, inventory mapping or required delivery configuration is unavailable or invalid, checkout fails closed.

## Order and inventory boundary

The transaction creates an order in `awaiting_confirmation`, with payment `unpaid` and fulfilment `unfulfilled`. It snapshots the server-derived quote and inventory deductions for the staff confirmation workflow.

Order submission does not reserve or deduct stock. Inventory is deducted only when an authorized staff member confirms the order through the trusted confirmation transaction.

## Security and reliability

- App Check is required by the guest session and order callables.
- A short-lived guest session credential is stored as a hash server-side.
- Idempotency protects retries against duplicate order creation.
- A separate high-entropy tracking credential is returned once; only its hash is stored.
- Tracking recovery requires the still-valid originating guest session.
- Customer tracking exposes a minimized status and payment/fulfilment projection.

## Rollout boundary

The implementation is committed to `tejuboss-foundation` and CI-tested. It remains a development preview. Firebase Functions, Firestore rules and App Check configuration have not been deployed or approved for production. The production shop and its legacy order flow remain unchanged.
