# Delivery policy administration and structured order queue

## Delivery policy administration

The foundation branch includes two callable endpoints:

- getDeliveryPolicy: reads the current private delivery policy for an authenticated owner or delivery manager.
- saveDeliveryPolicy: validates and version-writes the policy with an audit record.

Both require App Check. The policy editor supports flat-per-order and per-selling-unit pricing, base fees, explicit stable delivery-area IDs, area labels, area fees and active/inactive states. Amounts are stored as integer kobo. Existing selling-option fee overrides are preserved when the editor saves, even though this first UI does not edit those overrides.

The policy is initially disabled. No fee, area or charging method is activated on the live service by this code change. A staff member must explicitly enable it and save after the business has decided the actual values.

For checkout, fulfilment.area must contain the stable area ID configured here, not the display label. The future storefront area selector must use the same IDs. Pickup remains free.

## Structured order queue

The Orders tab now has a separate structured-checkout queue. It retrieves only orders with status awaiting_confirmation through an authenticated, App-Check-protected callable. The endpoint returns a bounded set of the newest pending orders and exposes only fields needed for order review.

Confirm and reject actions call the trusted decideOrder callable. Confirmation atomically deducts the recorded stock snapshot and writes inventory movements; rejection changes order status without stock deduction. Payment status is shown separately and is not automatically changed by order confirmation. Existing legacy orders remain in their own section and have not been migrated to this workflow.

## Security and rollout boundaries

- The private delivery policy cannot be read or written directly by browser clients.
- Order records cannot be directly changed by the new queue UI.
- Custom Firebase role claims must be provisioned for the staff account, and App Check must be configured.
- Functions and Firestore rules have not been deployed. No live delivery fee or stock balance has been changed.
- The order queue currently returns at most 100 items from a bounded 500-record pending-order query. A larger operational queue will need cursor pagination.
