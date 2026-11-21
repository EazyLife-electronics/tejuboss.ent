# Trusted Checkout Transaction Contract

Status: Transaction contract defined; Firestore adapter and callable endpoint are not implemented.
Branch: `tejuboss-foundation`
Production impact: none. This document does not authorize a deployment or data migration.

## 1. Purpose

Define the atomic boundary for a future guest or signed-in customer checkout. A successful checkout must commit the private order, idempotency result, customer-safe tracking projection, inventory balance changes, and append-only inventory movements together. A failed checkout must leave all of them unchanged.

The current `calculateCheckoutQuote` remains a read-only quote. It must not be presented as an order or as a stock reservation.

## 2. Trust boundary

The callable/backend endpoint must derive identity and authorization from verified server context:

- Signed-in customer: verified authentication UID.
- Guest: validate a server-issued guest-session credential and derive scope from its stored token hash.
- Admin-assisted order: separate explicitly authorized endpoint and audit actor.

Never accept a customer UID, guest scope ID, role, price, discount, stock balance, delivery fee, total, order ID, tracking hash, or inventory document path as authoritative input from the browser.

Require App Check and enforce request size, line-count, rate, and abuse controls before exposing guest-session issuance or order creation publicly.

## 3. Required verified configuration

The transaction implementation is blocked until these inputs are mapped from representative records or approved configuration:

1. Product, variant, and selling-option document paths and active/published fields.
2. Private pricing configuration path and the final quantity-tier semantics.
3. Active launch location ID.
4. Inventory-form definitions, including exact breakable package relationships.
5. Deterministic inventory balance key format and balance field names.
6. Delivery policy and delivery-area document paths, versions, and enabled states.
7. Approved customer-safe order and delivery tracking fields.
8. Order status and stock reservation/deduction policy at order placement.

Do not guess these from display labels, SKUs, legacy JSON, or product descriptions. The current domain inventory planner only supports whole-number piece stock.

## 4. Transaction preparation

Outside the Firestore transaction:

1. Validate and normalize the request using the checkout domain validator.
2. Derive the idempotency key hash from server-derived scope and the browser idempotency key.
3. Calculate the canonical request fingerprint from the normalized request, excluding transport-only fields where appropriate. The exact canonicalization version must be stored with the record.
4. Generate an order ID and a cryptographically random tracking credential once. Retain these values across Firestore transaction callback retries.
5. Never log the raw guest-session credential or raw tracking credential.

All pricing and stock decisions must still be based on documents read inside the transaction, not on a stale quote or browser state.

## 5. Transaction read phase

Firestore requires transaction reads to complete before writes. Read all required documents before issuing any write:

- Idempotency record.
- Current product and variant documents for every distinct cart line.
- Authoritative private pricing configuration for each affected variant.
- Delivery policy and selected area/zone documents when delivery is requested.
- Active location record.
- Every inventory balance and inventory-form definition needed for all lines and any planned break-pack conversions.
- Any required guest-session record, if its validity must be rechecked at order commit.

Deduplicate document references before reading. Revalidate published/active state, stable IDs, quantity precision, order steps, pricing rule dates, delivery eligibility, location status, and inventory configuration from the transaction snapshots.

Do not trust an earlier quote as proof that price, delivery, or stock is still valid.

## 6. Idempotency outcomes

After reading the idempotency record:

- No record: continue with a new checkout.
- Completed record with matching fingerprint: return the original safe order result; do not write or deduct stock again.
- Existing key with a different fingerprint: reject with an idempotency conflict.
- Processing record: return a retryable in-progress result; do not create another order.
- Failed/retryable record: only retry under a defined server-side state transition and attempt policy. Do not silently overwrite unknown states.

The idempotency record and order creation must commit atomically. A separate committed "processing" reservation is not part of the initial design unless a later implementation explicitly defines lease expiry and recovery.

## 7. Pricing and stock calculation

Within the transaction, recalculate all line prices from the authoritative catalogue and private pricing documents. Recalculate delivery from the current enabled policy and selected area.

For each line, resolve the stable product, variant, and selling-option IDs. Convert ordered quantity to required base stock units using explicit configured conversion data. Determine eligible inventory forms from verified policy.

For piece inventory that supports break-pack:

1. Read loose and sealed balances and form definitions.
2. Plan the minimum sealed packages to open.
3. Reject if available stock is insufficient.
4. Update sealed and loose balances in the same transaction as the sale deduction.
5. Record a break-pack movement and sale movement with before/after balances and a shared order reference.

Never route measured/fractional inventory through the whole-piece planner. Never break packages unless that selling option and inventory-form relationship explicitly permits it.

## 8. Atomic write set

Only after all reads and validations succeed, write:

- Private `orders/{orderId}` with immutable item, pricing, delivery, fulfilment, and customer snapshots.
- `orderTracking/{trackingTokenHash}` with minimal customer-safe status projection.
- Idempotency record with completed status, fingerprint, order ID, and safe replay result.
- Updated inventory balance documents.
- Append-only inventory movement documents for each sale and each package conversion.
- Audit record for system checkout creation where the audit model requires it.

All writes must be in the same Firestore transaction. Use deterministic document references and stable values prepared before callback retries. Do not send WhatsApp messages, email, payment requests, analytics, or external API calls inside the transaction callback.

The raw tracking token is returned to the customer only after a successful commit. Persist only its hash. If the transaction fails, do not expose the token or claim an order exists.

## 9. Payment, reservation, and fulfilment state

Payment status and fulfilment status are separate state machines. The business must explicitly choose whether stock is deducted at order placement or reserved until order confirmation/payment. The initial transaction must not mix payment settlement with stock changes.

External payment confirmation, messaging, and delivery-provider calls happen after commit through retry-safe tasks/outbox records. Their retries must not repeat stock deductions.

## 10. Failure and concurrency behaviour

- Insufficient stock: abort with no order, tracking projection, idempotency completion, movement, or balance change.
- Price or delivery configuration changed: return a refreshed quote/price-changed response; do not silently charge a stale amount.
- Concurrent purchases: Firestore transaction conflict/retry must re-read balances and fail one checkout if stock is no longer sufficient.
- Duplicate request: return the original order result for the same scope, key, and fingerprint.
- Same key, changed payload: reject.
- Invalid or expired guest session: reject before any write.
- Transaction callback retry: no external side effects and no regenerated externally visible identifiers.

## 11. Customer-safe response

The successful response may include:

- order reference;
- raw tracking token (once, for the customer to retain);
- customer-safe order status;
- trusted merchandise, delivery, and grand totals;
- currency and order timestamp.

It must not include internal stock balances, inventory paths, supplier/cost/margin data, staff notes, private payment references, or another customer's information.

Public tracking reads only the minimal projection by the hash of the supplied bearer token. Never make the private order or delivery collection publicly readable as a substitute.

## 12. Implementation gates

Before writing the Firestore adapter:

- Confirm representative product/variant documents and inventory records.
- Confirm the launch location and exact balance-key convention.
- Confirm the break-pack configuration for each sellable option.
- Confirm delivery fees, zones, and policy version.
- Confirm quantity-tier threshold versus marginal/slab behaviour and cross-unit qualification.
- Confirm stock deduction versus reservation timing.
- Add emulator tests for successful checkout, replay, key conflict, insufficient stock, concurrent oversell, changed price, expired guest session, pickup, delivery, break-pack, and tracking projection privacy.

No live rules deployment, production data migration, or production checkout cutover is included in this phase.
