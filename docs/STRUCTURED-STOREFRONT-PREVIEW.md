# Structured storefront preview

## Purpose

`catalogue-preview.html` is an isolated, read-only development page for reviewing the new structured catalogue. It does not replace or modify `shop.html`.

## Data flow

1. The page imports `js/structured-catalogue.mjs`.
2. The adapter queries `catalogueProducts` with the explicit constraint `published == true`, matching the public-read condition in `firestore.next.rules`.
3. Each returned document is checked by the shared structured catalogue validator and projected into a customer-facing view model.
4. The page displays product name, brand, category, description, variant, selling option and current unit price.
5. Invalid public records are skipped and logged; they are not silently rendered.

## Safety boundaries

- The page is not linked into the live navigation and does not replace the existing shop.
- It has no add-to-cart, checkout, order-write, inventory-write or stock-availability action.
- The public view model omits stock balances and private operational fields.
- A displayed price is informational only. Trusted checkout must re-read the authoritative catalogue and calculate the final quote on the server.
- Quantity-tier public pricing is not yet connected to this preview.
- The structured catalogue publisher still writes to `catalogueProducts`, not the legacy `products` collection.

## Before enabling customer ordering

Complete and test all of the following separately:

1. Inventory balance initialization and package/loose-stock integrity.
2. Trusted checkout quote and order-creation endpoint integration.
3. Idempotency, guest-session and order-tracking security integration.
4. Delivery policy confirmation and trusted delivery calculation.
5. Admin roles/custom claims provisioning and Functions deployment.
6. Firestore rules review and deployment only after the migrated storefront and admin workflows are ready.
7. End-to-end emulator tests for successful checkout, invalid/stale prices, insufficient stock, retries, and concurrent orders.

No Firebase rules or Functions deployment is performed by this preview implementation.
