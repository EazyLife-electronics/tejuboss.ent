import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { toPublicDeliveryOptions } from "./domain/public-delivery-options.mjs";

/** Returns only active customer-facing delivery choices and fees. */
export const getPublicDeliveryOptions = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) throw new HttpsError("invalid-argument", "This endpoint is for guest checkout.");
    if (request.data && Object.keys(request.data).length) {
      throw new HttpsError("invalid-argument", "This endpoint accepts no input.");
    }
    const snap = await getFirestore().collection("deliveryPolicies").doc("active").get();
    return toPublicDeliveryOptions(snap.exists ? snap.data() : null);
  }
);
