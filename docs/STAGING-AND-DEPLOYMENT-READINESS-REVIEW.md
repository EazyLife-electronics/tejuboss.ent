# TejuBoss staging and deployment readiness review

Review date: 22 November 2026  
Branch reviewed: `tejuboss-foundation`  
Scope: source and configuration review only. No Firebase project was changed and no deployment was performed.

## Current verification

- GitHub Actions run for commit `b1bf3dc3d94d2e15ae6b1d4c1aa9c29878d70bd8` passed both catalogue/pricing/inventory and Firestore emulator jobs.
- The follow-up App Check hardening for catalogue administration is committed separately and its CI run must be checked against the exact latest commit before this review is considered fully green.
- Quantity-pricing administration callables require App Check and owner/pricing-manager custom claims.
- Inventory, delivery, order, payment and archive administration callables inspected in this review already set `enforceAppCheck: true` and perform server-side role checks.
- Catalogue draft save/list/publish callables have now been changed to require App Check and perform owner/catalogue-manager authorization.

## Blocking prerequisites before any deployment

### 1. App Check web client configuration

File `js/firebase.mjs` still contains the placeholder `REPLACE_WITH_RECAPTCHA_V3_SITE_KEY`. A real reCAPTCHA v3 site key must be registered for the intended production domain and configured in the web client. Verify tokens are being issued from the deployed site before relying on App Check-protected callables.

Do not enable global Firestore App Check enforcement merely because callable enforcement is now enabled. Treat the callable App Check settings and any global Firestore enforcement as separate rollout decisions. The older `README-app-check.md` describes Firestore enforcement and should not be mistaken for proof that the new callable configuration is complete.

### 2. Custom claims and staff role provisioning

The backend authorizes operational actions using Firebase Auth custom claims, including `role: owner`, `catalogue_manager`, `pricing_manager`, `inventory_manager`, `delivery_manager`, and order/payment roles in their respective handlers.

The repository review does not prove that any real staff account has the correct claims. Before staging acceptance:
- Decide the named staff account(s) and least-privilege role(s).
- Provision claims only through a trusted, authenticated administrative process, never from the browser.
- Force a fresh ID token after claims are assigned.
- Test allowed and denied actions for each role, including a signed-in user with no role.
- Confirm owner access is limited to the intended owner account.

No claim has been assigned by this code review.

### 3. Firestore rules are not ready to deploy

The root `firestore.rules` currently contains legacy access patterns, including public order creation and public single-document reads of orders and deliveries. It is not a hardened ruleset for the new private order and guest-tracking model.

Do not deploy these rules as the new commerce rules. A separate staged ruleset and compatibility plan must be reviewed against every existing storefront feature and legacy order before any rules release. In particular, verify:
- Public clients cannot read full order, delivery, payment, customer, inventory or audit documents.
- Public checkout cannot write trusted order documents directly.
- Public tracking exposes only the minimal tracking projection through the intended trusted endpoint.
- Admin and staff access is least-privilege and cannot be escalated by client writes.
- Legacy pages do not depend on reads that the new rules will deny.

### 4. Admin UI is not equivalent to backend authorization

The legacy admin dashboard currently opens after Firebase email/password sign-in and does not itself gate the UI by custom claim. Backend callable checks remain authoritative for new commerce operations, but legacy Firestore listeners and writes must be checked against the eventual rules. Do not treat successful dashboard login as proof of a staff role.

### 5. Business and operational configuration

Before accepting real orders:
- Publish and verify the structured catalogue and every selling-option-to-inventory mapping.
- Enter physically counted opening stock, including loose and sealed package balances.
- Confirm all unit conversions and break-pack behavior against actual grocery products.
- Keep delivery disabled until approved areas, fees and fulfilment terms are entered.
- Confirm payment recording and order fulfilment workflows with a controlled test order.
- Configure the intended public tracking domain and verify DNS/hosting before customer use.

## Safe next sequence

1. Finish CI verification on the latest branch commit.
2. Add/verify App Check site key and production domain in a controlled staging release.
3. Provision and test custom claims for named staff accounts.
4. Prepare a separate hardened Firestore rules candidate and run emulator tests against legacy and new workflows.
5. Deploy to an isolated staging Firebase project only after its project ID and credentials are explicitly confirmed.
6. Complete end-to-end acceptance with test products and test orders.
7. Present a production rollout plan for explicit approval.

## Release boundary

This review is documentation and branch-only hardening. It does not authorize merging to `main`, changing live Firebase rules, deploying Functions, enabling global enforcement, or publishing the new checkout.
