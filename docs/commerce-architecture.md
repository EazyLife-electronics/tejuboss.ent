# TejuBoss commerce architecture (Spark-compatible rebuild)

## Scope and deployment boundary

This branch is a clean application rebuild against the existing Firebase project `tejuboss-ent`. The target collections are treated as a new, empty data model. Do not migrate or preserve assumptions from the previous TejuBoss order, product, delivery, or customer workflows.

This design must run on Firebase Spark using browser Firebase SDK calls and Firestore Security Rules. It must not depend on deployed Cloud Functions, Cloud Run, paid extensions, or a server secret. Existing Firebase Auth, App Check, ImageKit, and the TejuBoss media Worker remain infrastructure dependencies; no live rules, functions, Worker, database, or main-branch changes are authorized by this document.

## Trust boundaries

A browser-only Spark application cannot safely perform server-authoritative checkout pricing, private guest-order lookup, payment verification, or atomic inventory deduction. Firestore Rules can validate document shape and caller permissions, but cannot safely reproduce arbitrary catalogue pricing and inventory calculations across an unbounded cart.

Therefore:
- A guest checkout submission is an **order request**, not an accepted/confirmed sale.
- Client-submitted line prices and totals are display snapshots only. They are never authoritative.
- The order is visibly marked `awaiting_review` until staff checks current catalogue prices, availability, delivery charges, and customer details.
- Stock is not reserved or deducted at guest submission. Staff changes stock only after an explicit approval step, using admin-only writes and a stock movement record.
- The admin interface must not imply that browser-side order confirmation is a trusted atomic transaction. If atomic stock deduction, automated price calculation, payment webhooks, or fully private token-based tracking become mandatory, a trusted backend (and likely a Firebase billing upgrade) is required.

## Proposed top-level collections

### `catalogueProducts/{productId}`
Publicly readable only when `published == true`; writable only by the configured administrator.
Suggested fields:
- `schemaVersion: 1`
- `name, slug, description, brand, categoryId`
- `images: [{url, alt, sortOrder}]`
- `sellingOptions: [{id, label, sku, priceMinor, currency, enabled}]`
- `published, availability`
- `createdAt, updatedAt`

Do not expose cost price, supplier details, internal notes, or stock ledger data in public product documents. For a simple Spark launch, public stock availability should be a coarse `availability` state, not exact inventory quantity.

### `categories/{categoryId}`
Public read for active categories; administrator write. Fields: `name, slug, description, imageUrl, sortOrder, active`.

### `orders/{orderId}`
Created by guests with a high-entropy random ID. Readable and mutable only by the administrator. Store:
- `schemaVersion: 1`, `orderId`, `status: "awaiting_review"`
- Customer contact and fulfilment details needed to process the request
- Requested line identifiers and quantities, plus clearly labelled client display snapshots
- Client quote snapshot in minor currency units, marked `quoteStatus: "unverified"`
- `createdAt`, `updatedAt`
- Staff-only verification fields added later: verified line prices, accepted total, decision actor/time, internal notes

Never let a public client update an order after creation. Keep the schema allowlist narrow and bound string/list sizes in rules. Do not store payment credentials or sensitive identity documents.

### `orderTracking/{token}`
A separate, minimal, public-safe status projection keyed by an independently generated high-entropy bearer token (at least 128 bits of cryptographic randomness). It contains no customer name, phone, address, line items, or payment details. Guest creation is limited to an initial `submitted` state; only the administrator can update it. Public clients may perform a single-document `get` when they possess the exact token; list access is denied. Do not use sequential order numbers or short human-readable codes as bearer credentials.

If implementing secure token generation or atomic paired creation is not feasible in the browser, defer public tracking rather than exposing the private `orders` collection.

### `inventoryBalances/{balanceId}`
Administrator-only. One balance per product selling option and stock location. Fields include `productId, sellingOptionId, locationId, quantityOnHand, reorderLevel, updatedAt`. Exact stock values remain private.

### `inventoryMovements/{movementId}`
Administrator-only append-only ledger. Fields include `productId, sellingOptionId, locationId, quantityDelta, movementType, reason, referenceId, actorUid, createdAt`. Do not allow public writes or edits/deletes to historic movements.

### `siteSettings/{documentId}`
Public-readable projection only for genuinely public settings (store name, public contact channels, delivery explanation, currency). Private operational settings must be in an admin-only document or separate collection.

### `auditLogs/{logId}`
Administrator-readable, client writes denied. On Spark, browser writes are not a trusted audit source; use these records as staff activity notes only unless a trusted backend is introduced.

## Security invariants

1. Default deny for all collections not explicitly opened.
2. Admin authorization is based on the authenticated account's verified email matching the configured administrator; never trust a client-supplied role or email field.
3. Public product reads are limited to published catalogue records.
4. Guest order writes are create-only, strict-field-allowlist, size-bounded, and start in `awaiting_review`; guest read/list/update/delete are denied.
5. Public tracking documents contain no personal or commercial details; exact-token get only, no list/create-after-initial-state/update/delete by guests.
6. Inventory balances, movements, purchases, suppliers, delivery operations, payment records, and audit records are admin-only.
7. Client quote fields are untrusted and must be recalculated by staff before approval.
8. No browser checkout action deducts stock, marks payment paid, or changes an order to confirmed.

## Rollout sequence on the feature branch

1. Replace the legacy product/order schema with the clean catalogue, order-request, tracking, and inventory model.
2. Align public product projection, product manager, cart, checkout, and order confirmation screen.
3. Align admin order review and inventory screens with explicit manual verification and stock movement controls.
4. Add rules tests/emulator tests for public reads, guest create-only access, admin access, and denied cross-collection access.
5. Run branch preview and manual tests using a disposable/test Firebase project or emulator before considering any live database/rules action.

## Explicitly deferred

- Automatic authoritative checkout pricing and stock reservation/deduction.
- Payment gateway/webhook processing.
- Guest order retrieval by phone number or short tracking code.
- Public access to raw orders or deliveries.
- Any function deployment, billing upgrade, live Firestore rules deployment, Worker deployment, or merge to `main`.
