# Tejuboss trusted commerce domain

This workspace begins with pure, deterministic business calculations. It is intentionally not connected to the live Firebase project yet.

## Run tests

Use Node.js 22:

```bash
cd functions
npm test
```

## Current modules

- `src/domain/quantity-pricing.mjs`: integer-minor-unit price calculations, blended package-equivalent pricing, quantity conversion and tier threshold helpers.
- `src/domain/inventory.mjs`: pure planning for automatic sealed-carton-to-loose-unit conversion during a unit sale.
- `test/`: Node's built-in test runner coverage for the agreed business examples.

## Important boundary

These functions calculate deterministic results only. They do not read or write Firestore, authorize users, reserve stock, create orders, or provide atomicity by themselves. Production use must wrap them in trusted server handlers and Firestore transactions that read current balances/configuration and commit all related writes together.

Do not deploy this workspace or point it at the live Tejuboss project until the Firebase emulator, authorization, idempotency, tracking projection and migration work is implemented and tested.
