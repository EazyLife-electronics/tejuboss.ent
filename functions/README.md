# Tejuboss trusted commerce backend

Firebase project: `tejuboss-ent`  
Functions runtime: Node.js 22  
Working branch: `tejuboss-foundation`

## Phone-first development

No laptop is required for normal code changes or automated testing.

- Source changes are committed to the development branch through GitHub.
- GitHub Actions runs domain tests and Firestore security rules tests in cloud runners.
- Review test results from the repository Actions tab on a phone.
- Preview and test the storefront/admin in a mobile browser.
- A laptop is optional for local debugging only.

## Automated checks

Every push to `tejuboss-foundation` runs:
- Node.js domain tests for pricing and inventory calculations (`npm test`).
- A separate Firestore Emulator run (`npm run test:rules`) against `firestore.next.rules`, including public access, private orders, public tracking projections and owner access.

The staged rules are intentionally separate from the currently deployed-compatible `firestore.rules`. They are not ready to replace current rules until the storefront checkout and tracking pages have migrated to trusted Functions and the new tracking projection.

## Optional local development

With Node.js 22 and Java 21 installed:

```bash
cd functions
npm install
npm test
npm run test:rules
```

## Safety boundary

No production deployment has been performed. Do not deploy the staged rules until trusted order, pricing, inventory, tracking and authorization handlers are implemented, tested, and the legacy storefront migration is verified.
