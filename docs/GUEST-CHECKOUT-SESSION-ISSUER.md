# Guest Checkout Session Issuer

Status: Callable added on `tejuboss-foundation`; not deployed or connected to the storefront.
Production impact: none.

## Behaviour

- `createGuestCheckoutSession` is exported from the Functions entry point.
- Requires Firebase App Check (`enforceAppCheck: true`).
- Accepts no request fields and rejects signed-in callers.
- Creates a cryptographically random 256-bit token with a two-hour default lifetime.
- Stores only the SHA-256 token hash and timestamps in `guestSessions/{tokenHash}`.
- Returns the raw session token once, with its expiry.
- The staged Firestore rules explicitly deny all client reads and writes to session records.

## Not yet enabled for customers

This is groundwork only. It does not create an order, reserve or deduct stock, calculate delivery, or authorize checkout by itself. The storefront does not call it yet.

Before deployment or public use:
1. Configure and verify App Check for the web app and callable Functions.
2. Add server-side abuse/rate controls and monitoring for session issuance.
3. Implement the checkout callable and validate the session record inside its order transaction.
4. Confirm product/inventory document paths, delivery policy, stock timing, and launch location.
5. Complete emulator tests and review staged rules against all current client flows.

Do not deploy Functions or `firestore.next.rules` as part of this change.
