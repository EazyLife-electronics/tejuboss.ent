# Catalogue draft storage and account sync

## Current behaviour

The Structured Catalogue Builder validates drafts in the browser and stores a local copy in that browser's local storage. JSON export/import remains available as a backup and phone-to-computer transfer route.

The admin interface also includes **Sync to account** and **Load account drafts**. These call the authenticated Functions endpoints below. The endpoints store drafts in the private `catalogueDrafts` collection and never publish a product, alter inventory, or create a customer-facing catalogue record.

## Backend contract

- `saveCatalogueDraft`: requires Firebase Authentication and the `owner` or `catalogue_manager` custom claim.
- `listCatalogueDrafts`: same authorization; returns at most the 100 most recently updated drafts.
- Each save validates the structured catalogue draft again on the server.
- Saves use an integer version and optional `expectedVersion` to prevent silently overwriting a newer copy.
- Each successful save creates an audit-log entry.
- Direct client reads and writes to `catalogueDrafts` are denied by `firestore.next.rules`.
- Functions use the Admin SDK, which bypasses Firestore client rules; authorization is therefore enforced in the callable handlers.

## Important rollout requirements

These handlers and the admin controls are committed to the development branch only. They are **not deployed** to the Firebase project.

Before account sync can work:
1. Confirm the intended admin users have verified custom claims. An email address alone does not grant catalogue-manager access.
2. Review the deployed Firebase project and current rules.
3. Deploy the callable Functions and the reviewed rules in a coordinated rollout.
4. Test save, list, stale-version rejection, and denial for signed-in users without the required role.

Do not deploy `firestore.next.rules` alone. The rest of the storefront, checkout, tracking, and admin migration must be ready for the rules change.

## Future product publication

Draft storage deliberately does not write to `products`. A separate publishing workflow must review and normalize a draft, assign/confirm the canonical product document ID, and write a public-safe product record with an audit trail. Publication and inventory initialization must remain separate operations.
