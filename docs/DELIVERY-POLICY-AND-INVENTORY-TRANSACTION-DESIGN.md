# Delivery Policy and Inventory Transaction Design

Status: Pure domain planning implemented; production transaction integration pending approval and real data verification.

## Delivery policy

The old delivery calculator uses a cascading discount whose result can depend on cart line order. The new domain layer deliberately does not reproduce it.

Supported, explicit policy methods:

- `flat_per_order`: charge one configured base fee for the delivery order.
- `per_selling_unit`: multiply each trusted line quantity by its configured selling-option fee, falling back to the policy base fee.

An optional area fee is additive. A selling-option fee override applies only to `per_selling_unit`. Pickup always returns zero delivery charge. All monetary inputs and outputs are integer kobo. The calculator returns the policy version and a breakdown suitable for an immutable order snapshot.

No discount is silently applied. The policy must be enabled and versioned. Unknown delivery areas fail closed. The calculator consumes trusted server-side lines and policy data, never browser-submitted prices.

These are supported calculation primitives, not a decision that Tejuboss must adopt either method. Do not publish a policy until the business selects the intended charging method, fee amounts, delivery areas, and any discount approach.

## Inventory planning

`planLooseStockSale` is a pure planner for countable piece stock. It preserves separate sealed-package and loose balances.

Given requested loose units, current loose units, sealed package count, and explicit units per package, it calculates the minimum whole packages to open. The resulting plan transfers package contents to loose stock and deducts the sale. If stock is insufficient, it returns no movements and unchanged balances.

Example: 10 sealed cartons × 48 pieces, 0 loose pieces, sale of 6 pieces results in 9 sealed cartons and 42 loose pieces.

## Required Firestore transaction boundary

The planner does not mutate Firestore. A trusted checkout transaction must:

1. Validate the idempotency record and reject a conflicting request hash.
2. Read the current product, variant, selling option, private pricing configuration, public delivery policy, area eligibility, and relevant inventory balances.
3. Validate active states, quantity precision, minimums, steps, tier rules, and delivery policy version.
4. Plan sealed-package breakage where the selected selling option is allowed to consume loose stock.
5. Confirm every required balance is sufficient.
6. Create the order, idempotency record, public tracking projection, inventory movement ledger entries, and update balances atomically.
7. Return the same order result for a safe retry with the same idempotency key and same normalized request hash.

Do not perform external payment or messaging calls inside the Firestore transaction. Those belong in post-commit tasks/outbox processing.

## Important constraints

- The current planner supports whole-number piece inventory only. Measured stock (metres, litres, kilograms) requires precision-aware planning and must not be routed through this function.
- The business must explicitly configure which selling options consume sealed forms and which consume loose forms. Do not assume every carton or pack is breakable.
- Balance document IDs and inventory-form IDs must be derived from verified data and deterministic keys, not guessed from product labels.
- Firestore transaction integration remains blocked on actual representative product documents, inventory-form configuration, delivery-zone data, and a final delivery pricing decision.
- Do not deploy `firestore.next.rules` until all replacement storefront, checkout, tracking, and admin reads/writes are implemented and verified.
