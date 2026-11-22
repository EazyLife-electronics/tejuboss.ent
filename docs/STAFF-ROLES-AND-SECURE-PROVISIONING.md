# TejuBoss staff roles and secure provisioning

Review date: 22 November 2026  
Branch: `tejuboss-foundation`

This document describes the role contract currently enforced by the commerce Functions. It is an operational guide, not a mechanism for assigning claims. No staff account or custom claim is changed by this document.

## 1. Current role model

The backend currently reads one string claim: `request.auth.token.role`. A user therefore has one active operational role at a time. Do not assume that assigning several role names as separate claims will combine permissions; it will not. If a person needs multiple responsibilities, either assign the single role that safely covers the required workflow or design and test a deliberate multi-role authorization change before launch.

| Claim value | Current backend capability |
|---|---|
| `owner` | Full commerce administration across catalogue, pricing, inventory, delivery, order decisions, fulfilment, payments and archive |
| `catalogue_manager` | Save, list and publish structured catalogue drafts |
| `pricing_manager` | Read and publish private quantity-pricing configuration |
| `inventory_manager` | Initialize opening balances, save selling-option mappings, view inventory setup and adjust physical counts |
| `delivery_manager` | Read/save delivery policy, view delivery orders, update delivery fulfilment, and access permitted order archive data |
| `order_manager` | View order queue, confirm/reject orders, update pickup and delivery fulfilment, and access permitted order archive data |
| `payment_manager` | View payment-oriented order queue projection, record receipts, read payment history and access privacy-limited archive data |

The exact permissions are enforced in Functions, not by hiding buttons in the admin interface. A successful email/password login alone does not grant commerce permissions.

## 2. Safe provisioning procedure

Custom claims must be assigned by a trusted operator using Firebase Admin SDK in a controlled environment. Never expose a service-account private key, Admin SDK credential, claim-setting endpoint, or claim assignment UI in the browser.

Before provisioning:
1. Confirm the correct Firebase project is `tejuboss-ent`, not the EazyLife project or an emulator.
2. Identify the staff member by their Firebase Authentication UID from the trusted Firebase console or an authenticated administrative identity workflow. Do not rely on a user-supplied email string alone.
3. Confirm the business owner has explicitly approved the person's role and the least-privilege role is selected.
4. Record who approved the assignment, the UID, role, date and reason in the organization's restricted administrative record.
5. Have a trusted project administrator apply the claim through Admin SDK in a controlled environment, then verify the resulting token claims.
6. Revoke existing refresh tokens or require a fresh sign-in/token refresh so the user does not continue operating with an old token.
7. Test both an allowed operation and a denied operation for that account before granting operational access.

Example Admin SDK operation for a trusted server-side administrative environment only:

```js
await getAuth().setCustomUserClaims(uid, { role: "inventory_manager" });
```

This replaces the user's existing custom-claims object. If the application later adopts additional claims, preserve only explicitly approved claims in the same trusted operation. Never copy arbitrary client-supplied claims.

To revoke refresh tokens after a role change:

```js
await getAuth().revokeRefreshTokens(uid);
```

The user must obtain a fresh ID token after the change. The example is not a browser snippet and must not be added to a public page or callable endpoint.

## 3. Verification matrix

For every provisioned staff account, verify:
- Signed-out requests fail with `unauthenticated`.
- A signed-in account with no `role` claim fails privileged operations with `permission-denied`.
- The assigned role can perform only its documented actions.
- Other manager roles cannot invoke unrelated privileged operations.
- A role change takes effect only after a fresh token is obtained.
- App Check is valid on the actual staging web origin.

Recommended test cases:
- Catalogue manager: publish a test draft; confirm pricing and inventory administration are denied.
- Pricing manager: read and publish test pricing; confirm catalogue and stock administration are denied.
- Inventory manager: initialize and adjust test stock; confirm order decisions and payments are denied.
- Delivery manager: manage delivery policy and delivery fulfilment; confirm pickup-only fulfilment and payment recording are denied.
- Order manager: confirm/reject test orders and manage fulfilment; confirm payment administration is denied.
- Payment manager: record a test receipt and read its history; confirm order confirmation and customer-sensitive operational details are unavailable.
- Owner: verify all approved functions using a dedicated owner account, with strong account protection.

Do not use production customer orders or real stock to conduct these tests.

## 4. Important current limitations

- The current implementation supports one `role` string, not a list of simultaneous roles.
- This repository review does not establish which real UID is the authorized owner.
- No staff claims have been provisioned or verified.
- No claim assignment tool is exposed to the browser, by design.
- The legacy admin dashboard's sign-in state is not proof of a commerce role.
- Some older admin screens still use legacy Firestore listeners and writes. Their eventual access must be tested against the separately reviewed Firestore rules.
- This guide does not authorize a deployment or a change to the live Firebase project.

## 5. Release gate

Do not begin live staff onboarding until the intended project, staff UIDs, approved role assignments, App Check site key, staged rules and staging acceptance environment are confirmed. Complete the verification matrix in staging first, then obtain explicit approval for any production rollout.
