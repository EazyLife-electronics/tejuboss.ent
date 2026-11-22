# Secure Guest Order Tracking

Status: Development callables exported; not deployed or wired into the storefront.

## Customer lookup

Callable: `getGuestOrderTracking`.

- Requires a 256-bit URL-safe tracking token returned after a successful guest order.
- Order ID by itself is not an authentication credential.
- The server hashes the supplied token and looks up the private bearer-token projection.
- The token hash on the order must match the tracking record.
- The response is a strict customer-safe projection: order ID, order/payment/fulfilment statuses, total, timestamps and lifecycle timeline.
- It does not return customer phone/email, delivery address, customer note, line-item internals, stock balances, inventory mappings, staff identities or audit data.

The raw tracking token is never stored. Only its SHA-256 hash is stored.

## Lost-token recovery

Callable: `recoverGuestOrderTracking`.

Request: `sessionToken` and `orderId`.

- Requires the original short-lived guest checkout session.
- The order stores the hash of the guest session that created it, not the raw session token.
- The server verifies that the session is still valid and belongs to that exact order.
- Recovery rotates the tracking credential, deletes the previous tracking projection, and atomically updates the order hash and new projection.
- The new raw tracking token is returned once.
- A different guest session, expired/revoked session or unrelated order cannot recover it.

A successful recovery invalidates the previous tracking token. The storefront must store the session token securely for the session lifetime and retain the returned tracking token for the customer's tracking link. Do not put either credential in query-string parameters, analytics events or application logs. A URL fragment may be used for a customer-facing tracking link because fragments are not sent in the HTTP request, but the page must remove it from browser history after reading it.

## Lifecycle and payment

Order, payment and fulfilment states remain independent. Customer tracking reads authoritative order state; it does not expose staff-only delivery or operational records. Later delivery milestones can be added through a separate customer-safe projection when the delivery workflow is implemented.

## Rollout boundary

- Functions are not deployed.
- Firestore rules are not deployed.
- App Check still needs a real site key and production configuration.
- The existing `track.html` is the legacy tracking experience and has not been replaced.
- The structured storefront still needs to call session issuance, trusted order creation, token storage and the secure tracking page.
