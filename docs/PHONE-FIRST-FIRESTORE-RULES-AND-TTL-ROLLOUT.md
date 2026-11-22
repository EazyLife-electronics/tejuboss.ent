# Phone-first Firestore rules and TTL rollout guide

Status: Instructions prepared; no Firebase Console changes made.  
Project intended for staging: `tejuboss-ent`. Confirm the project name before every operation.

This guide is designed for Firebase Console on an Android phone. It does not ask you to deploy anything yet.

## Important: do not replace the live rules yet

- `firestore.rules` is the current root rules file and contains legacy public order and delivery reads.
- `firestore.next.rules` is the hardened candidate used by the emulator tests.
- The candidate currently blocks public reads of legacy order documents and delivery documents. The existing `track.html` still reads legacy orders and delivery documents directly. Replacing live rules with the candidate before that page is migrated will break existing tracking.
- The candidate also needs a full compatibility pass for existing public storefront collections and legacy admin workflows.
- Therefore, do not paste either file into the production rules editor as a deployment step yet.

## Part A: configure TTL after the code revision is deployed to an isolated staging project

The code now writes Firestore Timestamp fields:
- `guestSessions/{hash}.expiresAt`: the checkout session expiry, currently two hours after issuance.
- `checkoutIdempotency/{hash}.expiresAt`: 30 days after the idempotency record is created.

In Firebase Console on your phone:
1. Open the Firebase Console and select `tejuboss-ent`.
2. Open **Firestore Database**.
3. Open the **Time-to-live** tab (sometimes shown under the Firestore data/management tabs).
4. Create a TTL policy for collection group `guestSessions` using timestamp field `expiresAt`.
5. Create a second TTL policy for collection group `checkoutIdempotency`, also using `expiresAt`.
6. Review the collection group and field name carefully before saving each policy.

TTL deletion is asynchronous and can take many hours. It is only storage cleanup. The Functions already reject expired sessions by checking their timestamps, so security does not depend on the deletion happening immediately.

Do not create a TTL policy for `orders`, `orderTracking`, `deliveries`, or `auditLogs` as part of this task. Those records have different retention requirements.

## Part B: where to edit Firestore rules when the candidate is approved

When a compatible rules release is ready:
1. Open Firebase Console and select the explicitly confirmed staging project.
2. Open **Firestore Database**.
3. Select the **Rules** tab.
4. Keep the existing rules untouched in a separate note or copy before editing.
5. Replace the editor contents only with the exact approved rules file supplied for that release.
6. Read the project name and rules preview one more time.
7. Use **Publish** only after explicit approval for that specific staging release.
8. Return to the Rules tab and confirm the published rules timestamp/version.

Do not edit the root production project rules while following a staging guide. Never use a service-account key or paste credentials into chat.

## Part C: post-publication checks

Use the approved staging test checklist to verify:
- Public storefront can read only published product/catalogue and public pricing data.
- Public clients cannot read full guest orders, customer contacts, payment records, inventory, staff notes, or audit logs.
- Guest tracking works through the trusted callable and returns only the customer-safe projection.
- Legacy tracking continues to work only if its migration/compatibility plan explicitly preserves it.
- Staff accounts can access only the operations allowed by their verified custom role.
- Unauthenticated clients cannot create or modify trusted commerce orders directly.

## Current status

- Code-side TTL timestamps: committed on the development branch.
- TTL policies in Firebase Console: not configured.
- Staging project deployment: not performed.
- Firestore rules publication: not performed.
- Production rules: untouched.
- A legacy storefront/tracking compatibility review is still required before any rules replacement.
