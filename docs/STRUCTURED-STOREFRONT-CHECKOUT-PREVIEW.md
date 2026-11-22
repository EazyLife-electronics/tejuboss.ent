# Structured Shop and Guest Checkout Preview

Status: Additive development preview committed and CI-tested. It is linked from the existing `shop.html` as a clearly labelled preview entry. It is not a production checkout rollout.

## Page and behaviour

`structured-shop.html` is a separate storefront experience. The legacy `shop.html` and its existing cart/order implementation remain unchanged.

The preview provides:
- Published structured catalogue browsing and search.
- Stable variant and selling-option selection.
- Quantity precision, minimum and order-step handling.
- Public quantity-offer display where published.
- Guest basket and contact/fulfilment form.
- Pickup as the safe default; delivery only when an active policy is available.
- Secure callable order submission using IDs and quantities, not browser prices or totals.
- Order reference, tracking credential handoff and same-device tracking.
- Tracking-token recovery while the original guest session remains valid.

## Trusted pricing and stock

The basket amount is an estimate. The backend recalculates current catalogue prices, eligible tier rules and configured delivery charges.

No stock balance is exposed publicly. The backend snapshots inventory deductions when an order is created, but stock is not deducted until authorized staff confirm the order.

Orders begin awaiting confirmation and unpaid. The preview does not collect online payment or mark an order paid.

Delivery remains unavailable unless a valid active policy is configured. No zones or fees have been assumed.

## Before real-world ordering

The preview cannot safely create real orders until the following are reviewed and explicitly approved:
1. Staged Firestore rules and Functions are deployed to the separate Tejuboss Firebase project.
2. Firebase App Check is configured with the correct reCAPTCHA v3 site key and domains.
3. Admin custom role claims and staff permissions are provisioned and verified.
4. Structured products are published, opening inventory is initialized, and every selling option has a valid inventory mapping.
5. Delivery areas and charges are explicitly configured if delivery is offered.
6. A controlled test order is verified in the staff queue, inventory movements and customer tracking.

Do not deploy rules or Functions, enable production App Check, or merge to `main` without explicit authorization. The existing production shop remains the live ordering path.
