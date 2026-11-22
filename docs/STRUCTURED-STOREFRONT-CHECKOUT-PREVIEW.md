# Structured Shop and Guest Checkout Preview

Status: Development-only page committed. It is not linked from the production homepage, not deployed as a live checkout, and not connected to a production rollout.

## Page

`structured-shop.html` is an additive storefront experience. The existing `shop.html` and its cart/order implementation remain unchanged.

The page provides:
- Published structured catalogue browsing and search.
- Stable variant and selling-option selection.
- Quantity handling using each variant's configured decimal precision, minimum quantity and order step.
- Public quantity-offer display where a published offer exists.
- A guest basket and contact/fulfilment form.
- Pickup as the safe default. Delivery appears only when an active delivery policy is available.
- Secure callable submission that sends IDs and quantities only, never browser prices or totals.
- Customer order reference, private tracking token handoff and same-device order tracking.
- Session-based token recovery while the original guest checkout session remains valid.

## Important commercial boundaries

- The displayed basket amount is an estimate based on current public catalogue unit prices. The backend recalculates final prices, promotions, quantity tiers and delivery.
- No stock quantity is exposed to the public catalogue. Inventory is checked through the trusted backend at order creation and stock is deducted only when staff confirms the order.
- Orders are created as awaiting confirmation and unpaid. This page does not collect online payment or mark orders paid.
- Delivery is hidden unless an active policy is configured. No delivery zones or fees have been assumed.
- The page does not add a new homepage navigation item or replace the legacy shop.

## Before real-world testing

The page cannot create real orders until all of the following are reviewed and explicitly approved:
1. The staged Firestore rules and Functions are deployed to the separate Tejuboss Firebase project.
2. A reCAPTCHA v3 site key is configured for Firebase App Check, with the correct production domains.
3. The admin account has the required custom role claims and staff access has been verified.
4. At least one structured product is published, has opening inventory, and every selling option has a valid inventory mapping.
5. If delivery is offered, delivery areas and charges are explicitly configured and saved by staff.
6. A controlled test order is placed and verified through the admin order queue, inventory movements and customer tracking.

Do not deploy or enable App Check enforcement merely to make this preview work. The existing rules and Functions remain staged until the user authorizes rollout.
