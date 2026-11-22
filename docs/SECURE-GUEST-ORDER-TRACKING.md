# Secure Guest Order Tracking

Status: Backend callables are exported, emulator-tested and connected to the structured storefront preview adapter. Not deployed.

## Customer lookup

Callable: `getGuestOrderTracking`.

- Requires a high-entropy tracking bearer token returned after successful guest order creation.
- Order ID alone is not an authentication credential.
- The server hashes the token and verifies the private tracking projection against the order.
- Customer-safe response includes order reference, order/payment/fulfilment statuses, total, timestamps and lifecycle timeline.
- It excludes customer contact details, delivery address, customer note, inventory internals, staff identities and audit data.

The raw tracking token is not stored server-side; only its SHA-256 hash is stored.

## Token storage and recovery

The preview adapter saves the tracking credential in the browser's local storage for same-device order tracking. The short-lived guest session credential and retry payload are held in session storage.

Callable: `recoverGuestOrderTracking`.

- Requires the original, still-valid guest checkout session and exact order ID.
- The order stores the originating session hash, never the raw session credential.
- Recovery rotates the tracking token, invalidates the old projection and returns the new token once.
- A different or expired session cannot recover the order's tracking credential.

Do not place credentials in analytics, logs or query-string parameters. If a future shareable tracking link uses a URL fragment, the page must remove it from browser history immediately after reading it.

## Rollout boundary

- Functions and Firestore rules remain undeployed.
- App Check needs a real site key and domain configuration.
- Custom staff claims and access must be provisioned and verified.
- The legacy `track.html` remains unchanged.
- Preview integration does not authorize production rollout.
