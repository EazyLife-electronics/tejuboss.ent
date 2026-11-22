# Legacy product administration security

The legacy grocery catalogue is managed through the `manageLegacyProducts` Firebase callable in `europe-west1`.

- App Check is enforced on every operation.
- Public storefront reads use the minimized `publicList` projection.
- Admin listing and mutations require the `owner` or `catalogue_manager` custom claim.
- Product and variant payloads are allowlisted and bounded before writes.
- Create, update, and delete operations record an audit event.
- This callable migration does not deploy Firebase Functions or change live Firestore rules.

Before launch, configure the Firebase App Check web provider and the authorized staff custom claims.
