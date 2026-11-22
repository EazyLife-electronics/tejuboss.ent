# Firebase App Check: reCAPTCHA Enterprise

TejuBoss's web app is registered in Firebase App Check with **Fraud Defense (formerly reCAPTCHA Enterprise)**.

## Current implementation

- Firebase web app: `tejuboss-ent`
- Firebase project: `tejuboss-ent`
- SDK initialization: `js/firebase.mjs`
- Provider: `ReCaptchaEnterpriseProvider`
- Site key: configured in `js/firebase.mjs` (public browser key)
- Automatic App Check token refresh: enabled
- Enforcement: **not yet enabled**

The Firebase Console registration confirms that the provider is attached to the Firebase web app. It does not, by itself, prove that a deployed copy of the website is successfully obtaining tokens.

## Staging verification still required

1. Deploy the current `main` website code to a staging URL using the project's chosen hosting workflow.
2. Open the staging site in a normal browser session and check the browser console/network for App Check initialization errors.
3. Confirm App Check token exchange succeeds and requests to protected callable Functions include valid App Check tokens.
4. Confirm the Firebase App Check metrics show verified requests for the registered web app.
5. Test guest checkout and the protected order tracking/admin flows in staging.
6. Keep enforcement disabled until the staging checks pass and the production website has been updated.

## Important deployment and enforcement cautions

- Do not enable Firestore or callable Functions enforcement as part of registration alone.
- Do not deploy `firestore.next.rules` or replace the active Firestore rules without a separate review and explicit approval.
- Do not assume a local emulator test proves browser token acquisition.
- If staging uses a different hostname, add that hostname to the reCAPTCHA Enterprise key's allowed domains before testing.
- Keep a rollback path for the website deployment before enabling enforcement.

## Hosting note

The repository's current `firebase.json` configures Functions, Firestore rules, and emulators, but does not define a Firebase Hosting target. The actual website deployment target and staging hostname must therefore be confirmed before browser-level verification can be completed.
