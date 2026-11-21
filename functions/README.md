# Tejuboss trusted commerce backend

Firebase project: `tejuboss-ent`  
Functions runtime: Node.js 22  
Working branch: `tejuboss-foundation`

## Local setup

Install the Firebase CLI and authenticate locally:

```bash
npm install -g firebase-tools
firebase login
```

From the repository root:

```bash
cd functions
npm install
cd ..
firebase emulators:start --only auth,functions,firestore
```

The emulator suite uses the project alias in `.firebaserc`. It does not connect to production services while the emulators are running.

- Auth emulator: http://127.0.0.1:9099
- Functions emulator: http://127.0.0.1:5001
- Firestore emulator: http://127.0.0.1:8080
- Emulator UI: http://127.0.0.1:4000

## Smoke test

The initial callable endpoint is `backendStatus`. It confirms that the Functions runtime is reachable and returns only service metadata. It does not read or write customer or commerce data.

## Domain calculations

- `src/domain/quantity-pricing.mjs`: integer-minor-unit pricing calculations.
- `src/domain/inventory.mjs`: sealed-carton to loose-unit conversion planning.
- `test/`: Node's built-in test coverage.

## Safety boundary

No production deployment has been performed. Do not run `firebase deploy` until the trusted order, pricing, inventory, tracking and authorization handlers are implemented and emulator-tested.

The existing browser checkout still writes orders directly to Firestore. It must not be considered secured by this initial Functions connection. The migration must replace that path before public order-write rules are tightened.
