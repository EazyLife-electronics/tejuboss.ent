# Structured catalogue publication

## What publication does

The admin's **Publish record** action calls the authenticated `publishCatalogueDraft` callable. It requires an `owner` or `catalogue_manager` custom claim, a cloud-saved draft, and the exact draft version last loaded by the admin.

The backend:
1. Loads the private draft and checks its version.
2. Revalidates the complete draft.
3. Requires the draft to be explicitly marked for publication.
4. Builds a public-safe structured product projection using stable IDs and explicit stock conversions.
5. Includes only active variants and active selling options that pass checkout catalogue validation.
6. Writes to `catalogueProducts/{productId}` and an audit log in one Firestore transaction.

Inactive variants and selling options remain in the private draft so they can be reactivated later. Private draft data is not copied wholesale. No inventory balances, stock quantities, supplier data, or cost fields are created or changed.

## Why this is a separate collection

The existing `products` collection is still used by the legacy storefront and admin editor. Its product and variant shape differs from the new structured catalogue contract. Writing the new shape into those existing documents could break product cards, cart logic, order processing, and inventory handling.

Therefore publication currently writes to the additive `catalogueProducts` collection. The staged rules allow public reads of published documents and deny all direct client writes. The current storefront does not yet read this collection, so publishing a record does **not** make it appear in the live shop.

## Remaining integration work

- Build a storefront adapter that reads `catalogueProducts` and renders the structured selling options and public quantity offers.
- Replace legacy browser-authoritative order creation for these products with the trusted checkout endpoint.
- Connect inventory initialization and stock operations through a separate controlled workflow.
- Migrate legacy products only through an explicit reviewed migration, never by overwriting them automatically.

## Rollout

All changes are development-branch code and staged rules only. No Functions or Firestore rules have been deployed. Custom-claim provisioning and the coordinated storefront/checkout migration remain prerequisites for production use.
