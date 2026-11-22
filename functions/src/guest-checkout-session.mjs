import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { createGuestSessionCredential } from "./domain/guest-session.mjs";

/**
 * Issues a short-lived guest checkout bearer credential.
 * App Check is required; no customer data or order is created here.
 */
export const createGuestCheckoutSession = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) {
      throw new HttpsError("invalid-argument", "This endpoint is for guest checkout.");
    }
    if (request.data && Object.keys(request.data).length !== 0) {
      throw new HttpsError("invalid-argument", "This endpoint accepts no input.");
    }

    const now = Date.now();
    const credential = createGuestSessionCredential({ now });
    const ref = getFirestore().collection("guestSessions").doc(credential.tokenHash);

    await ref.create({
      schemaVersion: 1,
      tokenHash: credential.tokenHash,
      createdAtMillis: credential.createdAtMillis,
      expiresAtMillis: credential.expiresAtMillis,
      expiresAt: Timestamp.fromMillis(credential.expiresAtMillis),
      revokedAtMillis: null,
      createdAt: FieldValue.serverTimestamp()
    });

    return {
      sessionToken: credential.rawToken,
      expiresAtMillis: credential.expiresAtMillis
    };
  }
);
