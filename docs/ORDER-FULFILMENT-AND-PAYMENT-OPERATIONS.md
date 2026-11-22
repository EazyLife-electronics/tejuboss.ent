# Order fulfilment and payment operations

## Scope

This phase adds staff-managed fulfilment progress and manual receipt recording to the structured commerce order flow. It does not connect a bank, POS terminal, transfer notification service or payment gateway. It does not deploy Functions or Firestore rules.

## Order and fulfilment states

The commerce decision state remains separate from fulfilment:

- `awaiting_confirmation`: submitted by customer, not yet accepted; no stock has been deducted.
- `confirmed`: staff accepted the order and the trusted confirmation transaction deducted stock.
- `rejected`: staff declined the order; no stock deduction.

Confirmed orders begin with `fulfilmentStatus: unfulfilled`.

Pickup transitions:

1. `unfulfilled` → `preparing`
2. `preparing` → `ready_for_pickup`
3. `ready_for_pickup` → `fulfilled` (collected)

Delivery transitions:

1. `unfulfilled` → `preparing`
2. `preparing` → `dispatched`
3. `dispatched` → `fulfilled` (delivered)

The backend validates each transition, checks the previous state supplied by the staff client, restricts pickup/delivery-specific transitions, and writes an audit event. Delivery-provider integration and proof-of-delivery capture are not included.

## Manual payment receipt recording

Payment is independent from order acceptance and fulfilment. The callable `recordOrderPayment` records an amount already received by the business. It does not initiate, verify or settle a bank transfer, cash transaction, POS payment or online payment.

- Staff can enter the payment method as a short label, so the shop is not locked into a payment-method list.
- Amounts are integer kobo; partial receipts are supported.
- The backend rejects zero/negative amounts and amounts exceeding the outstanding order balance.
- Payment receipts are written to `orders/{orderId}/payments/{paymentId}`.
- Payment IDs are derived from a client idempotency key, so retrying the same submission does not duplicate a receipt.
- The order's `paymentTotalMinor` and `paymentStatus` are updated transactionally.
- Payment status is `unpaid`, `partially_paid`, or `paid` based on the recorded total.
- Every receipt creates an audit log entry.
- Payment staff can see order/payment totals but the staff queue omits customer phone, email and delivery address for that role.

The structured order queue includes phone-friendly client-side search across the currently loaded orders (order ID, customer/contact, address and item details) and filters for confirmation, fulfilment stages, completed orders and outstanding payment. The queue still loads a bounded active-order set from the server; these filters do not search historical orders outside that returned set.\n\nThe authorized owner/payment staff can open a read-only payment history for each order. It lists receipts chronologically with amount, method, optional reference, receipt time and cumulative paid total. Staff UIDs are not exposed to the browser. The history is limited to 200 entries per order in this view.\n\nThe first version does not implement refunds, reversals, payment disputes, automatic bank verification, gateway webhooks, reconciliation exports or cash-drawer accounting. Incorrect entries require a controlled correction process before live use; do not edit payment ledger records directly.

## Roles

- `owner`: order and fulfilment actions, payment receipt recording.
- `order_manager`: order confirmation/rejection and fulfilment.
- `delivery_manager`: delivery order queue and delivery fulfilment progression.
- `payment_manager`: confirmed-order payment queue and manual receipt recording.

These are custom-claim role names. Existing sign-in does not automatically grant them. Production access requires an intentional role-provisioning process and App Check configuration.

## Verification

The emulator integration test covers pickup fulfilment progression, customer tracking timeline, stale transition rejection, partial payment, idempotent replay, overpayment rejection, final settlement, customer tracking payment status, payment history ordering and field minimization, and payment-role authorization.

## Rollout boundary

The implementation is committed only to `tejuboss-foundation`. Do not deploy it until the storefront, admin UI, Functions, App Check, custom claims and staged Firestore rules have been reviewed together. Existing production rules and role claims have not been verified by this code change.
