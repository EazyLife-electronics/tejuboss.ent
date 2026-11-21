# Tejuboss trusted commerce backend

Firebase project: `tejuboss-ent`  
Functions runtime: Node.js 22  
Working branch: `tejuboss-foundation`

## Phone-first workflow (recommended)

You do not need a laptop for normal development with this repository.

- Work on source files, review changes and commit through the GitHub repository in a mobile browser or the GitHub mobile app.
- Automated tests run in GitHub Actions whenever changes are pushed to `tejuboss-foundation`.
- Review test results from the repository's **Actions** tab on your phone.
- Preview the website through the branch preview URL and test the storefront/admin from your phone.
- Firebase deployment can later be run by a protected GitHub Actions workflow after staging configuration and explicit approval are in place.

A laptop is optional for local debugging, not a prerequisite for the workflow.

## Automated checks

The GitHub Actions workflow runs the Node.js 22 commerce-domain test suite on every push to `tejuboss-foundation` and on relevant pull requests.

## Optional local development

If you happen to have a laptop available, you can run the same checks locally:

```bash
cd functions
npm install
npm test
```

The Firebase emulator suite can also be run locally with the Firebase CLI, but it is not required for ordinary code changes or automated domain tests.

## Smoke test

The initial callable endpoint is `backendStatus`. It confirms that the Functions runtime is reachable and returns only service metadata. It does not read or write customer or commerce data.

## Domain calculations

- `src/domain/quantity-pricing.mjs`: integer-minor-unit pricing calculations.
- `src/domain/inventory.mjs`: sealed-carton to loose-unit conversion planning.
- `test/`: Node's built-in test coverage.

## Safety boundary

No production deployment has been performed. Do not deploy until trusted order, pricing, inventory, tracking and authorization handlers are implemented and tested.

The existing browser checkout still writes orders directly to Firestore. It must not be considered secured by this initial Functions connection. Replace that path before public order-write rules are tightened.
