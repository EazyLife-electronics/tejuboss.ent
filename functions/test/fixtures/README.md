# Synthetic checkout fixtures

The data in `functions/test/fixtures/sample-tejuboss-data.mjs` is fabricated test data. It is not copied from a customer, supplier, or production catalogue.

The fixtures model:
- a sample LED bulb sold individually or as a sealed carton of 48;
- a sample extension cable sold individually;
- one sample Ibadan delivery policy with two illustrative area fees;
- ten sealed cartons and zero loose pieces for the sample LED bulb.

They are imported only by automated Node tests. They are not part of the website catalogue, are not uploaded to Firebase, and must never be used to seed the production project.

The scenario tests verify trusted quote calculation, selling-option conversion, delivery and pickup pricing, package breakage planning, insufficient-stock rejection, idempotency replay/conflict classification, and tracking-token hashing.

`sample-firestore-checkout.mjs` is a separate emulator-only harness. It uses an isolated `__checkoutEmulatorFixtures` namespace and proves atomic writes, replay safety, insufficient-stock rollback, current-price reads, customer-safe tracking projections, and concurrent oversell prevention against the Firestore Emulator. It is not imported by production Functions.

The emulator harness deliberately models one sample product and one piece-selling option per request. It is a transaction-pattern test, not the production Firestore schema or a deployable checkout endpoint. The production adapter must be built only after real product/inventory paths, package forms, delivery policy, tier semantics, and stock reservation timing are approved.
