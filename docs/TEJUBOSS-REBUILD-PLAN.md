# Tejuboss Platform Rebuild Plan

## Direction

Build Tejuboss as a retail and wholesale commerce platform using the proven engineering patterns from EazyLife, without treating the existing Tejuboss implementation as a specification that must be preserved.

The implementation is Tejuboss-specific. Reuse only components and patterns that pass review. Rebuild weak or unsuitable areas rather than layering patches over them.

## Business priorities

1. Launch dependable retail product discovery and ordering.
2. Support wholesale quantities, carton pricing and approved retailer/customer price tiers.
3. Support inventory and fulfilment across outlets or warehouses.
4. Add supplier, procurement and replenishment workflows.
5. Keep the architecture extensible for a future multi-distributor marketplace, without building marketplace complexity into the first release.

## Engineering principles

- Keep the Tejuboss Firebase project separate from EazyLife.
- Keep production branch `main` untouched until explicit approval.
- Develop and test on `tejuboss-foundation`.
- Treat Firestore rules as a security boundary, not as a workaround for frontend behaviour.
- Never trust browser-submitted prices, totals, discounts, stock figures or order status.
- Keep customer PII and internal operational records private.
- Expose only a deliberately limited public tracking view.
- Use trusted server-side functions for price calculation, order creation and inventory-changing operations.
- Preserve payment state separately from fulfilment/order state.
- Design for mobile-first usage, accessibility, SEO and low-bandwidth conditions.
- Prefer modular, testable code and additive, reviewed data migrations.

## Initial domain model proposal

This is a planning model, not yet a deployed schema. Final fields and relationships must be verified against actual Tejuboss product and operational requirements before implementation.

### Catalogue
- `categories`: category hierarchy, visibility and merchandising order.
- `products`: identity, description, media, category, publication state and product-level policies.
- `productVariants` or embedded `variants`: sellable units, SKU, unit/pack/carton definitions, attributes and active state.
- `priceLists`: retail, wholesale and customer-group pricing rules.
- `promotions`: time-bounded and eligibility-constrained offers.

### Inventory and locations
- `locations`: outlets, stores and warehouses.
- `inventory`: per-location quantity, reserved quantity and reorder thresholds by sellable variant.
- `stockMovements`: immutable audit trail for receipts, sales, adjustments, transfers and reversals.
- `stockReservations`: time-bounded reservations where the checkout workflow requires them.

### Customers and commerce
- `customers`: customer profile and contact information, with appropriate access controls.
- `retailerAccounts`: wholesale eligibility, approval state, assigned price list and credit terms where applicable.
- `orders`: private order record, authoritative item snapshots, customer details and operational state.
- `publicOrderTracking`: restricted tracking projection with no private contact, address, payment or internal-note fields.
- `payments`: payment attempts and confirmed payment ledger, separate from order fulfilment.
- `deliveries`: private fulfilment assignment and operational detail.

### Operations
- `suppliers`, `purchaseOrders`, `goodsReceipts`: supplier and procurement workflow.
- `users` / role claims: admin, sales, inventory, fulfilment and other least-privilege roles.
- `auditLogs`: sensitive administrative and stock-changing actions.

## Security and trust boundaries

- Public visitors may read only published catalogue data and explicitly public configuration.
- Public visitors must not directly read private orders, customer records, payments, deliveries or audit logs.
- Public order submission must go through a trusted backend endpoint.
- The backend must reload product/variant data, validate availability and quantity, calculate authoritative prices and totals, and write the order atomically.
- Admin access must be role-based and validated by Firestore rules and backend authorization, not merely by hiding UI tabs.
- Tracking must return a safe projection, not the underlying order or delivery document.
- Do not deploy new rules or functions until the replacement flows and legacy-order compatibility have been tested.

## Delivery sequence

### Phase 0: Foundation audit and specification
- Compare the current Tejuboss branch with the current EazyLife implementation.
- Inventory reusable modules, missing modules, legacy assumptions and hard-coded brand/domain values.
- Inspect real product/variant document shapes and existing inventory/order workflows.
- Confirm the retail checkout and wholesale pricing rules.
- Produce a reviewed collection schema, access matrix and migration plan.

### Phase 1: Secure commerce foundation
- Establish Firebase Functions and local emulator/test configuration.
- Implement trusted catalogue pricing and order submission.
- Separate private order data from public tracking projections.
- Define safe Firestore rules and callable endpoint authorization.
- Add tests for invalid products, stale prices, quantities, duplicate submissions and unauthorized reads.

### Phase 2: Retail storefront
- Deliver responsive home, category, search, product detail, cart and checkout experiences.
- Make product availability and order confirmation reliable.
- Provide accessible WhatsApp fallback/contact paths without silently bypassing server validation where online ordering is available.
- Add SEO metadata, structured data and performance checks.

### Phase 3: Operations admin
- Product, category, variant, media and price-list management.
- Order processing, payment recording and delivery coordination.
- Inventory by location with auditable stock movements.
- Role-based access, activity history and operational reports.

### Phase 4: Wholesale and distribution
- Retailer applications and approvals.
- Customer-specific or tier-based price lists.
- Minimum order quantities, carton pricing and bulk rules.
- Multi-location stock, transfers, procurement and supplier workflows.

### Phase 5: Marketplace readiness
- Only after the single-business retail and wholesale workflows are stable, assess multi-distributor tenancy, seller onboarding, settlement and marketplace search.

## Acceptance gates

A phase is not complete because its UI renders. It must pass relevant functional, security and mobile checks. In particular, no production deployment or migration occurs without explicit owner approval.

## Current working branch

`tejuboss-foundation`, created from the EazyLife-derived `upgrade-from-eazylife` baseline. The prior `tejuboss-ecommerce-v2` work remains available for reference and has not been merged into this foundation branch.
