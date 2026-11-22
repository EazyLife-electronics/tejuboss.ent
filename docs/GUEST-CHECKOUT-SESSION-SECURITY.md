# Guest Checkout Session Security

Status: Session primitives, session issuer and trusted guest-order callable implemented on the development branch. Deployment and live storefront integration remain pending.

Guest checkout must not trust a browser-supplied customer ID or idempotency scope. Before a guest can create an order, a trusted callable endpoint should issue a cryptographically random 256-bit session credential.

The server stores only:
- SHA-256 token hash as the document ID;
- matching token hash;
- creation timestamp;
- expiry timestamp;
- optional revocation timestamp.

The raw credential is returned once to the browser and sent with checkout requests. It must never be logged or persisted in Firestore. The server hashes the credential, loads the hash-keyed private session record, validates expiry/revocation and derives the idempotency scope from the hash.

Recommended initial lifetime is two hours, with a hard maximum of 24 hours. A session should be refreshed through a new credential rather than extending an old token indefinitely.

The session collection must deny all public reads and writes. Only Admin SDK code may access it. The callable requires App Check. Session records now also include an `expiresAt` Firestore Timestamp matching the two-hour credential expiry, so a Firestore TTL policy can remove expired records. TTL policy configuration is a separate Firebase Console operation and has not been enabled yet. Per-IP/application-level throttling remains a separate hardening item before public launch.

The guest session callable stores hash-only records and returns the raw token once. The `createGuestOrder` callable validates the session, reads current published structured catalogue and private pricing, applies configured delivery, records a trusted inventory deduction snapshot, and creates a pending order plus safe tracking projection transactionally. Order placement does not reserve or deduct stock. Both callables require App Check and reject signed-in clients at the guest endpoint. The inventory mappings, delivery policy and catalogue must be initialized by authorized backend/admin workflows before real checkout can succeed. The endpoint is not deployed or connected to the live storefront.


## Firestore TTL cleanup

The session record includes an `expiresAt` Timestamp for the Firestore TTL service. Configure a TTL policy for collection group `guestSessions`, timestamp field `expiresAt`. TTL deletion is asynchronous and is not an authorization control: expired credentials are rejected by server-side timestamp validation even before Firestore physically deletes their records.
