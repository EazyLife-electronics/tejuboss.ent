# Tejuboss Platform Rebuild Plan

## Direction

Build Tejuboss as a retail and wholesale commerce platform using the proven engineering patterns from EazyLife, without treating the existing Tejuboss implementation as a specification that must be preserved.

The implementation is Tejuboss-specific. Reuse only components and patterns that pass review. Rebuild weak or unsuitable areas rather than layering patches over them.

## Business priorities

1. Launch dependable public retail ordering with guest checkout.
2. Make retail and quantity-based wholesale/upsell prices visible to every visitor from the first release.
3. Support multiple selling options per product, with admin-controlled quantity tiers and cross-unit pricing eligibility.
4. Track unopened packages and loose stock separately, with automatic audited break-pack conversion when loose stock is insufficient.
5. Launch with one store/fulfilment location while retaining location IDs for future expansion.
6. Strengthen supplier, procurement, payment, delivery and reporting workflows after the secure commerce foundation.
7. Keep the architecture extensible for future multi-distributor marketplace capability, without building marketplace complexity into the first release.

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

The detailed target contract is documented in:
- [Target Data Model and Access Matrix](TARGET-DATA-MODEL-AND-ACCESS.md)
- [Product Units and Pricing Model](PRODUCT-UNITS-AND-PRICING-MODEL.md)
- [Pricing Engine and Checkout Workflow](PRICING-ENGINE-AND-CHECKOUT-WORKFLOW.md)
- [Phase 1 Implementation Checklist](PHASE-1-IMPLEMENTATION-CHECKLIST.md)

Key confirmed decisions:
- Public product prices and quantity offers; no account or approval required.
- Guest checkout; accounts are optional for saved details and order history.
- Multiple selling options per variant, each with explicit conversion and price.
- Sealed packages and loose stock are separate inventory forms.
- Unit sales may trigger automatic carton break-pack conversion, recorded atomically.
- Quantity-tier qualification and price calculation are administrator-controlled.
- Cross-unit equivalent pricing is allowed only when explicitly configured.
- One active fulfilment location for the initial release.

The target model separates public catalogue/pricing projections from private costs, pricing configuration, inventory ledgers, orders, payments, delivery operations and audit logs. It is a logical contract, not a deployed schema. Do not create every proposed collection before its launch use is established.

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
- Completed initial repository and architecture audit.
- Confirmed product-specific selling units and multiple selling options.
- Confirmed separate sealed-package and loose-stock balances with automatic break-pack conversion.
- Confirmed one store for initial fulfilment.
- Confirmed public quantity offers, guest checkout and optional customer accounts.
- Produced target data model, access matrix, product-unit contract and pricing/checkout workflow specifications.

### Phase 1: Secure commerce foundation
- Establish Firebase Functions and local emulator/test configuration without deploying to production.
- Implement canonical product/variant/selling-option contracts.
- Implement private pricing configuration and safe public pricing projections.
- Implement deterministic quantity-tier evaluation, including configured cross-unit and blended package-equivalent pricing.
- Implement trusted order submission, idempotency, safe tracking projection and atomic inventory conversion/deduction.
- Add emulator tests for price tampering, stock races, break-pack conversion, duplicate submissions, authorization and tracking privacy.
- Design an export, dry-run migration and rollback process before touching live data.

### Phase 2: Public storefront and checkout
- Deliver responsive home, category, search, product detail, cart and checkout experiences.
- Show public price tiers and next-quantity upsell prompts without requiring sign-in.
- Support guest checkout and optional customer accounts.
- Make availability, repricing, order confirmation and tracking reliable.
- Add SEO metadata, structured data, accessibility and performance checks.

### Phase 3: Operations admin
- Product, category, variant, selling-option and media management.
- Admin controls for base prices, quantity tiers, qualification basis, blended pricing, effective dates and preview/testing.
- Order processing, payment recording and delivery coordination.
- One-location inventory balances, goods receiving, break-pack, adjustments and auditable stock movements.
- Role-based access, activity history and operational reports.

### Phase 4: Distribution expansion
- Add additional outlets/warehouses and inter-location transfers when the business is ready.
- Extend supplier, procurement, replenishment and retailer account workflows.
- Consider customer-specific negotiated price lists only if the business later requires them.

### Phase 5: Marketplace readiness
- Only after first-party retail, public quantity pricing and distribution workflows are stable, assess multi-distributor tenancy, seller onboarding, settlement and marketplace search.

## Acceptance gates

A phase is not complete because its UI renders. It must pass relevant functional, security and mobile checks. In particular, no production deployment or migration occurs without explicit owner approval.

## Current working branch

`tejuboss-foundation`, created from the EazyLife-derived `upgrade-from-eazylife` baseline. The prior `tejuboss-ecommerce-v2` work remains available for reference and has not been merged into this foundation branch.
