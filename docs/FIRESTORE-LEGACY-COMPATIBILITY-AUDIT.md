# Firestore legacy compatibility audit

Review date: 22 November 2026  
Branch: `tejuboss-foundation`  
Scope: source review only. No live rules changed.

## Finding 1: the legacy tracking page directly reads orders

The existing `track.html` imports `getOrderByTrackingCode` from `js/store.mjs`. That helper performs a direct Firestore document read from `orders/{trackingCode}`. The current root rules permit public document gets on `orders`.

The new commerce flow creates documents with random UUID IDs, `source: "guest"`, and private customer/order fields. The new tracking callable `getGuestOrderTracking` instead requires a 256-bit bearer token, resolves the private order server-side, and returns a minimized customer-safe projection.

The hardened candidate `firestore.next.rules` denies public direct reads of `orders`. That is correct for the new order model, but it will break the old tracking page until the page is migrated or a deliberately bounded legacy compatibility rule is introduced.

## Finding 2: legacy tracking directly reads delivery documents

The existing `track.html` also calls `getDelivery(deliveryId)`, which directly reads `deliveries/{deliveryId}`. The page renders only a few fields, but the full document is downloaded to the public browser. The root rules currently permit public gets on delivery documents.

The hardened candidate denies public delivery reads. This will also break the legacy tracking page. Simply restoring public reads would preserve the old exposure of full delivery documents, so the preferred fix is a trusted delivery-tracking callable that returns only approved customer-facing fields, followed by migration of the legacy tracking page.

## Finding 3: legacy and new order schemas coexist

The old order workflow uses tracking-code document IDs and legacy fields such as `customerName`, `phone`, `items`, `total`, and `status`. The new trusted checkout writes a distinct schema with `schemaVersion: 1`, `source: "guest"`, UUID IDs, `customer`, `lines`, integer minor-unit totals, inventory deduction snapshots and a private tracking-token hash.

Do not make a broad rule that grants public access to every document in `orders`. If temporary legacy reads are retained, they must explicitly exclude the new guest schema. New guest order creation and all trusted updates must remain server-side only.

## Required migration sequence

1. Add a customer-safe legacy tracking callable or a carefully scoped adapter that never returns phone, address, internal notes, payment references or full delivery documents.
2. Update `track.html` to use the trusted tracking callable for new orders and the safe compatibility endpoint for legacy orders.
3. Test old tracking links, new tracking tokens, delivery status display, rejected/cancelled orders and invalid credentials in an emulator/staging environment.
4. Review every public storefront collection and every legacy admin listener/write against the candidate rules. The candidate's catch-all deny is intentional but may block existing features not yet migrated.
5. Extend Firestore emulator tests to cover legacy and new schemas side by side, including direct-read denial for new guest orders and safe legacy tracking.
6. Only after the above, prepare a complete replacement ruleset and a phone-friendly staging publication procedure.

## Current release decision

`firestore.next.rules` is a strict security candidate, not yet a drop-in replacement for `firestore.rules`. Do not publish it to production or staging until the tracking migration and compatibility test suite are complete. No Firestore rules have been published as part of this review.
