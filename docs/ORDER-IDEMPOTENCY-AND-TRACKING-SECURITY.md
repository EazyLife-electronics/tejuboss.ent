# Order Idempotency and Tracking Security

Status: Pure domain primitives implemented; Firestore transaction integration pending.

## Idempotency

The browser supplies an idempotency key for one checkout attempt. The trusted backend derives the scope from authenticated UID or a server-issued guest session; it must never trust a scope/customer identity supplied in the request body.

The backend derives a deterministic SHA-256 document key from a versioned namespace, server-derived scope, and idempotency key, plus a request fingerprint from a canonical serialization of the validated request.

Expected transaction behaviour:
1. Read the idempotency record before creating an order or changing inventory.
2. If completed with the same fingerprint, return the original order result without repeating stock changes.
3. If the same key is reused with a different fingerprint, reject with an idempotency conflict.
4. If processing, return a retryable in-progress response.
5. Otherwise create a processing record and the order, inventory movements, stock balance changes, and completed idempotency record in one Firestore transaction where practical.

Firestore transaction callbacks may be retried. Do not generate externally visible side effects inside a retryable callback. All writes must be deterministic for a given transaction attempt. The order ID and tracking credential should be generated before entering the callback or by a carefully designed transaction reservation flow, then reused across retries.

Guest scope must be established by a server-issued, high-entropy session credential or another verified mechanism. A raw browser-selected scope is not authorization.

## Tracking credential

Generate a 256-bit random bearer token. Persist only its namespaced SHA-256 hash as the orderTracking/{tokenHash} document ID. Return the raw token once to the customer after successful order creation. Never store the raw token in the order document, logs, analytics, or public projection.

The tracking page hashes the supplied token and reads only the minimal public-safe projection. Possession of the token grants access to that projection, so it must be treated as a secret. Avoid logging it, embedding it in referrers, or exposing it to third-party scripts.

A hash alone does not make a tracking projection safe. Keep the projection limited to order reference, customer-safe status, relevant timestamps, and explicitly approved delivery progress. Exclude phone, address, payment references, staff notes, private delivery details, and full order contents.

## Current implementation boundary

The order-security module provides deterministic idempotency derivation, replay classification, and tracking token generation/hashing. It performs no Firestore reads or writes and does not yet create orders. The trusted Cloud Function must integrate these primitives with the order and inventory transaction.
