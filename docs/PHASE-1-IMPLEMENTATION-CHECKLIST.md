# Phase 1 Implementation Checklist

Status: Backend foundation implemented on development branch; production rollout is still blocked
Working branch: `tejuboss-foundation`

This checklist translates the approved business rules and target architecture into a safe implementation order. It is not evidence that any item has already been implemented.

## Implementation progress (22 November 2026)

The development branch now contains tested checkout foundations, with no live deployment:

- Firebase Functions workspace, emulator configuration, CI and pure-domain test suite.
- Structured catalogue validation/publication and a separate preview, preserving the legacy shop.
- Public-safe quantity offers and private server-side tier pricing, including effective-date checks.
- Guest checkout session issuer with hash-only credentials and session expiry validation.
- Trusted `createGuestOrder` callable: server-side catalogue, tier and delivery calculation; idempotent order creation; customer-safe tracking projection; no browser totals or prices.
- Orders start `awaiting_confirmation`; submission neither reserves nor deducts stock.
- Trusted `decideOrder` callable: authorized staff decision, atomic inventory update and ledger, idempotent confirmation/rejection.
- Pure grocery confirmation planner with explicit balance conversions, loose-first stock allocation, sealed-carton break-pack and tests.
- Private inventory mappings, delivery policy and idempotency collections in staged rules.
- Emulator fixture tests for stock-neutral order placement, confirmation, rejection, replay, insufficient stock and concurrency.

The pure-domain test job passed on the latest completed run. Firestore emulator security tests for the latest commit are still running.

## Remaining production prerequisites

- Admin workflow to initialize physically counted stock balances and create/verify inventory mappings.
- Admin delivery-policy configuration and approved real delivery charges/areas.
- Custom claims for owner/order/inventory roles, verified and assigned securely.
- App Check production configuration.
- Guest storefront integration and safe customer wording for pending confirmation.
- Recovery/return/payment workflows and migration of legacy open orders.
- Staging acceptance, deployed-rule audit, explicit approval and rollout plan.

The callable endpoints are exported but not deployed. Existing legacy storefront and live Firestore data remain unchanged.

## 0. Current repository constraints observed

- The repository has an existing `firestore.rules` file with public order creation and public reads of full order and delivery documents.
- Existing product administration stores variant price, promotion, stock and bulk-savings fields in the legacy product structure.
- Existing `js/pricing.mjs` contains delivery-fee calculations and legacy variant/bulk helpers; it is not the new authoritative quantity-tier pricing engine.
- The product editor currently has a simple per-variant bulk-savings toggle with inherited or own flat percentage/minimum quantity. It cannot express the agreed tiered, cross-unit, blended package-equivalent rules.
- The development branch now has a `functions/` workspace, root Firebase/emulator configuration, automated domain tests and GitHub Actions CI. Production Firebase configuration and deployment remain separate.
- `js/firebase.mjs` contains the dedicated Tejuboss Firebase project configuration and an unconfigured App Check placeholder. Do not enforce App Check until a valid site key and rollout plan exist.
- The admin order messaging code currently contains a hard-coded `https://tejuboss.ent` tracking URL. The intended public domain is `tejuboss.ng`; the tracking base URL must become configuration-driven and must not be treated as live until DNS/hosting is connected.

These constraints must be addressed in the development branch before production cutover. Do not patch production rules or live data as part of setup.

## 1. Development and test environment

- [ ] Add Firebase CLI project configuration for the Tejuboss project without embedding service-account credentials.
- [ ] Add a Functions workspace using a supported Node runtime and pinned dependencies.
- [ ] Configure Firestore and Functions emulators for local development.
- [ ] Add deterministic seed fixtures for products, variants, selling options, package forms, price tiers, stock balances and orders.
- [ ] Add unit/integration test scripts and CI checks.
- [ ] Keep emulator/staging project IDs separate from `tejuboss-ent` production.
- [ ] Document local setup, test commands, environment variables and deployment safeguards.

## 2. Canonical catalogue contract

- [ ] Define schema validators for product, variant, selling option and inventory-form documents.
- [ ] Assign stable IDs to variants, selling options and inventory forms.
- [ ] Support product-specific selling options: unit, pack, roll, carton, and configured custom options.
- [ ] Store explicit stock conversions and package contents; never parse pack size from product text.
- [ ] Validate whole-number quantities for countable goods and configured precision for measured goods.
- [ ] Preserve legacy product fields during the transition; do not delete or reinterpret them until migration is tested.
- [ ] Build an admin preview for selling options and their stock conversions.

## 3. Inventory ledger and break-pack

- [ ] Implement one active store location for launch.
- [ ] Implement inventory balances per variant and physical inventory form.
- [ ] Keep sealed cartons/packs/rolls separate from loose stock.
- [ ] Implement a trusted atomic break-pack operation.
- [ ] Implement unit-sale stock allocation: consume loose first, open the required number of cartons for any shortfall, then deduct the sale.
- [ ] Ensure break-pack conversion and sale are committed together or not at all.
- [ ] Write append-only movement records for receipts, break-pack conversions, sales, adjustments, returns and reversals.
- [ ] Add concurrency tests proving two orders cannot consume the same units.
- [ ] Add stock reconciliation reports showing sealed form, loose form and base-equivalent totals separately.

## 4. Public quantity pricing engine

- [ ] Create private authoritative pricing configuration per product variant.
- [ ] Create public-safe pricing projections containing only published prices, thresholds and public offer terms.
- [ ] Support independent tiers at unit, pack, roll and carton levels.
- [ ] Support selected-option, base-stock-equivalent and explicitly enabled cross-option qualification.
- [ ] Support fixed effective unit price, percent/fixed reduction and blended package-equivalent pricing.
- [ ] Support admin-defined tier priority, effective dates, stacking policy and eligible options.
- [ ] Reject conflicting or invalid tier configurations during publication.
- [ ] Build a server-side quote/pricing function used by both storefront preview and order submission.
- [ ] Build an admin tier preview/test tool before publishing changes.
- [ ] Add tests for the documented 10-piece example: pack of 6 at ₦5,000, unit at ₦1,000, blended total ₦9,000, while the customer still receives 10 individual pieces.
- [ ] Ensure no quantity offer requires login or customer approval.

## 5. Trusted order and tracking

- [ ] Define a strict public order request schema.
- [ ] Accept product ID, variant ID, selling-option ID, quantity, customer/fulfilment details and idempotency key only.
- [ ] Ignore/reject client-submitted prices, discounts, stock figures and totals.
- [ ] Recalculate pricing from current trusted configuration.
- [ ] Return a repricing/availability confirmation if the quote changes before order acceptance.
- [ ] Use idempotency to prevent duplicate orders and duplicate stock deductions.
- [ ] Write private order snapshots, payment state and fulfilment state separately.
- [ ] Generate unguessable tracking tokens and store only protected lookup references.
- [ ] Publish a minimal tracking projection with no private customer, address, payment, staff or rider details.
- [ ] Preserve a compatibility plan for existing legacy orders before changing public tracking reads.

## 6. Security and roles

- [ ] Define owner and operational role permissions.
- [ ] Enforce authorization in backend handlers and Firestore rules.
- [ ] Deny public direct writes to orders and all client-side writes to inventory.
- [ ] Keep public reads limited to published catalogue, public pricing projections and public settings.
- [ ] Keep full orders, payments, customers, deliveries, costs and audit logs private.
- [ ] Allow customers to read only their own account profile and order history.
- [ ] Keep guest checkout fully supported.
- [ ] Add security tests for direct Firestore writes, cross-customer reads, tracking enumeration and privilege escalation.
- [ ] Do not deploy tightened rules until replacement endpoints and tracking compatibility are verified.

## 7. Admin experience

- [ ] Redesign product editor around variants, selling options, inventory forms and package conversions.
- [ ] Add a dedicated quantity pricing editor with independent controls per selling level.
- [ ] Show public preview of each configured offer.
- [ ] Add safe publish/unpublish and effective-date handling.
- [ ] Add stock form balances and explicit break-pack controls for staff where required.
- [ ] Add stock movement history and adjustment reasons.
- [ ] Add order price breakdown showing selected tier and calculation snapshot.
- [ ] Add role-aware admin navigation and action authorization.

## 8. Migration and cutover

- [ ] Obtain an authorized export or staging copy of current Firestore data.
- [ ] Build an idempotent dry-run migration with a detailed report.
- [ ] Map old variants to stable IDs and resolve ambiguous labels manually.
- [ ] Configure every actual package conversion with business confirmation.
- [ ] Reconcile legacy embedded stock against new sealed/loose balances.
- [ ] Reconcile open orders and payment records.
- [ ] Back up live data and document rollback steps.
- [ ] Run the full acceptance suite against staging/emulators.
- [ ] Obtain explicit owner approval before any production migration, rules deployment or release.

## 9. Definition of Phase 1 complete

Phase 1 is complete only when all critical tests pass:
- public quantity offers are available to guests;
- guest checkout works without account creation;
- all authoritative pricing and stock decisions happen on the backend;
- configured cross-unit and blended pricing produces the expected amount;
- break-pack produces the correct sealed and loose balances atomically;
- concurrent orders cannot oversell;
- order retries are idempotent;
- public tracking exposes only customer-safe information;
- unauthorized direct Firestore writes and reads are denied;
- staging migration reports reconcile without unexplained stock/order differences.

No production deployment or migration is included in this checklist's authorization.
