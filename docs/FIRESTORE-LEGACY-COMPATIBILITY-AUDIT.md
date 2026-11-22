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


## Legacy tracking migration implementation update

The branch now contains an initial compatibility migration:

- `getLegacyOrderTracking` is an App Check-protected callable.
- It requires the legacy tracking code plus the last four digits of the phone number recorded on the order.
- It rejects the new UUID-based guest-order schema.
- It returns a bounded customer-facing projection and reads delivery data only on the server.
- `track.html` now calls this endpoint; it no longer performs direct Firestore reads of order or delivery documents.
- The public tracking page no longer loads saved legacy codes automatically because each lookup needs the phone suffix.

This is source-level implementation, not a deployment. The real App Check site key is still a prerequisite. The legacy code plus phone suffix is a compatibility factor, not equivalent to the 256-bit token used by new guest orders. Privacy-safe per-IP/application throttling and emulator/staging tests of the callable response remain required before any public rollout. The separate structured checkout preview continues to use its high-entropy tracking token flow.


## Broader legacy collection and admin workflow audit

The source review confirms that `firestore.next.rules` is intentionally a strict security boundary, but it is not yet a compatible replacement for `firestore.rules`. The following live source modules still use direct Firestore client operations:

| Collection | Existing use | Current legacy rule behavior | Hardened candidate status | Required migration / decision |
|---|---|---|---|---|
| `products` | Public shop reads; admin create/edit/delete; inventory and purchase transactions update variant stock | Public read, admin write | Public read only when `published == true`; catalogue-manager write | Existing product documents may not have `published`. Audit real document shape and storefront query before enforcing this predicate. Move stock mutations to trusted inventory functions before disabling admin transaction writes. |
| `heroes` | Public homepage content; admin CRUD | Public read, admin write | Denied by catch-all | Add public-safe read and owner/marketing role writes after checking the hero schema and public fields. |
| `reviews` | Public review display; public submission; admin approve/edit/delete | Public read/create, admin update/delete | Denied by catch-all | Add strict public create validation and approved-only public reads. Staff moderation should be role-gated. |
| `requests` | Public sourcing request submission; admin queue and status updates | Public create, admin read/update/delete | Denied by catch-all | Preserve validated public create; restrict reads and status changes to owner/order-support role. Add field/type/length limits and abuse controls. |
| `settings` | Public storefront settings read; admin settings update | Public read, admin write | Denied by catch-all | Split public-safe settings from private operational configuration. Do not expose payment, staff, or private delivery settings through a general public document. |
| `orders` | Legacy order create/tracking; admin order/customer/payment views and status changes | Constrained public create, public get, admin list/update/delete | Staff reads only; all client writes denied | Migrate all customer order creation, status changes, payment records and tracking to trusted Functions. The tracking page migration is in progress; audit other order readers and admin UI adapters before rules rollout. |
| `orders/{id}/payments` | Admin payment ledger direct reads/writes | Admin CRUD | Payment-role read only; all client writes denied | Finish callable migration for payment recording/refunds and test customer ledger, reports and payment history. |
| `inventoryMovements` | Legacy stock adjustment, purchase receipt and void transactions; inventory reports | Admin CRUD | Inventory/report role read; all client writes denied | Route all stock mutations through trusted atomic Functions, including purchase receipt/void. Preserve report access through a safe role-specific read or callable projection. |
| `purchases` | Purchase receiving, history, void transaction | Admin CRUD | Denied by catch-all | Receive, void and history now use App Check protected inventory-manager callables; verify supplier-master migration and emulator coverage before rollout. |
| `suppliers` | Supplier master create/read/update and purchase linking | Admin CRUD | Denied by catch-all | Add supplier-manager/inventory-manager access or trusted callable APIs. Supplier contact details are private. |
| `deliveryPersonnel`, `deliveryTypes`, `deliveryCheckpoints` | Delivery operations configuration and admin CRUD | Admin CRUD | Denied by catch-all | Add delivery-manager access with field validation, or move operations to callables. These collections are not public. |
| `deliveries` | Admin delivery queue and lifecycle; legacy tracking read | Public get, admin list/write | Delivery/order role read; client writes denied | Finish server-side delivery lifecycle writes and customer-safe tracking projection. Never restore public reads of full delivery documents. |
| `customers` | Customer account records | No explicit legacy match | Customer can read/write own UID document in candidate | Verify whether this collection is used by the current site and whether customer self-write fields can be abused before retaining this rule. |
| `catalogueProducts`, `publicPricing` | New structured storefront projections | Not present in legacy rules | Public read of published/enabled projections; no client writes | Retain trusted publisher-only writes and test exact public projection contents. |
| `guestSessions`, `checkoutIdempotency`, `catalogueDrafts`, `pricingConfigs`, `inventoryMappings`, `deliveryPolicies` | Private backend state | Not present in legacy rules | All direct client access denied | Keep backend-only. |
| `inventoryForms`, `inventoryBalances`, `auditLogs`, `orderTracking`, `deliveryTracking` | New structured inventory, audit and token tracking | Not present in legacy rules | Role-limited reads or token-only single-document reads; no client writes | Keep private or customer-safe by projection. Confirm each UI uses the corresponding callable/token adapter. |

### Important implementation observations

1. The legacy admin dashboard currently signs in with email/password and then subscribes to collections. The browser UI does not itself provision or enforce the custom role claims used by the hardened rules. A signed-in account without a verified `role` claim will be denied by the candidate rules.
2. The current legacy rules use an email allow-list for admin access. The hardened candidate uses a custom claim. Staff claim provisioning and least-privilege role assignment must be completed and tested before rollout.
3. Legacy purchase receiving and voiding have now been moved to App Check protected Functions. The backend updates product variant stock, purchase state, inventory movement and audit record in one transaction. Purchase history is returned through a role-checked callable. The browser no longer performs the purchase stock transactions. Manual stock-in/stock-out adjustments in the legacy Inventory tab now use an App Check protected callable with an expected-current-quantity check, mandatory reason, idempotency key, atomic product update, movement and audit record. SKU/cost/reorder metadata edits and legacy product reads remain direct-client paths and still need migration.
4. The current delivery operations UI still directly creates and updates delivery records and configuration collections. It needs a delivery-manager callable migration before the candidate's no-client-write policy can be adopted.
5. Public reads of entire `settings`, `orders`, or `deliveries` documents are not acceptable as a compatibility shortcut. Use purpose-built public projections or callable responses with explicit field allow-lists.
6. Existing product documents and public homepage content need a data-shape audit. A rule predicate such as `published == true` can make legacy documents disappear if the field was never populated.
7. The candidate rules are tested as a security candidate, not as a drop-in deployment. The emulator suite currently validates the new security boundaries. It must be expanded with migrated legacy workflow tests as each adapter is replaced.

### Purchase migration implementation update\n\n- Added `receiveLegacyPurchase`, `voidLegacyPurchase` and `listLegacyPurchases` in `functions/src/purchase-operations.mjs`.\n- Receiving validates supplier, product/variant, whole-unit quantity, whole-naira unit cost and an idempotency key. It creates or links a supplier record, increments the legacy variant stock, records the purchase, writes an inventory movement and writes an audit event atomically.\n- Voiding retains the original purchase record, rejects repeat/invalid transitions, prevents stock from going below zero, reverses the stock effect and records movement/audit entries atomically. It remains compatible with legacy purchase document IDs.\n- Purchase receiving, voiding and history in the admin Purchases tab now call the trusted backend. No direct browser transaction changes product stock.\n- Manual stock-in/stock-out adjustments in the legacy Inventory tab also use a trusted callable. It rejects stale quantities, requires a reason, and commits stock, movement and audit entries atomically.\n- These callables require `owner` or `inventory_manager` claims and App Check. The real App Check key and staff claims are not yet configured.\n- Supplier Master maintenance, SKU/cost/reorder metadata edits, and some product reads still contain legacy direct Firestore access. This is a partial migration, not a claim that the hardened candidate rules can be deployed.\n\n## Current rollout decision

Do not replace the live rules yet. The next implementation slices should be:

- Public content: migrate heroes, reviews, public settings and requests to explicitly scoped rules/projections.
- Inventory and purchases: move receive, adjustment, void and stock mutation transactions behind trusted Functions.
- Delivery: move create, assign, transition, checkpoint and configuration writes behind delivery-manager Functions; keep full delivery records private.
- Orders and payments: finish all legacy admin/customer adapters and test the customer ledger and reporting flows.
- Roles: provision test identities with each supported custom claim and verify both allowed and denied operations.
- End-to-end emulator tests: cover public shop, homepage, review/request forms, admin tabs, purchasing, supplier master, stock reports, delivery operations, customer records and tracking.

No production rules or Functions have been deployed as part of this audit.
