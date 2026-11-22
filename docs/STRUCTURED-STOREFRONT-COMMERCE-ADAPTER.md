# Structured storefront commerce adapter

Status: Client adapter committed as an additive module. It does not replace `shop.html` or the legacy `js/store.mjs` order writer.

## Adapter

`js/structured-commerce.mjs` provides:
- `getStructuredDeliveryOptions()`: reads only the public-safe active delivery areas and fee settings.
- `submitStructuredGuestOrder(...)`: sends stable product, variant and selling-option IDs, quantity, customer details and fulfilment intent. It sends no prices or totals.
- `getStructuredOrderTracking(token)`: retrieves the customer-safe tracking projection.
- `recoverStructuredOrderTracking(orderId)`: rotates the token using the still-valid guest session.
- `getSavedStructuredTrackingOrders()`: reads locally saved tracking credentials for this browser.

An identical retry in the same browser session reuses the same idempotency key. If the first response was lost after the server created the order, the replay path securely rotates and returns a fresh tracking token.

The guest session is kept in sessionStorage for its short lifetime. Tracking tokens are saved in localStorage so the customer can return to tracking on the same device. These are bearer credentials; do not copy them into analytics, logs or query strings.

## Rollout limits

- App Check's real site key is not configured in `js/firebase.mjs`; enforced callables will not be usable from the browser until it is.
- Functions are not deployed.
- The legacy shop remains unchanged.
- The structured catalogue preview remains read-only.
- This adapter is not yet wired to a customer checkout UI.
- No Firebase rules or production data were changed.
