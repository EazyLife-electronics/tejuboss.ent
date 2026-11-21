# Synthetic checkout fixtures

The data in `functions/test/fixtures/sample-tejuboss-data.mjs` is fabricated test data. It is not copied from a customer, supplier, or production catalogue.

The fixtures model:
- a sample LED bulb sold individually or as a sealed carton of 48;
- a sample extension cable sold individually;
- one sample Ibadan delivery policy with two illustrative area fees;
- ten sealed cartons and zero loose pieces for the sample LED bulb.

They are imported only by automated Node tests. They are not part of the website catalogue, are not uploaded to Firebase, and must never be used to seed the production project.

The scenario tests verify trusted quote calculation, selling-option conversion, delivery and pickup pricing, package breakage planning, insufficient-stock rejection, idempotency replay/conflict classification, and tracking-token hashing.

These tests exercise domain decisions and pure planners. They do not yet prove Firestore transaction atomicity or concurrent oversell prevention; those require the transaction adapter and emulator integration tests.
