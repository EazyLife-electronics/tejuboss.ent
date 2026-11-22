import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createTrackingCredential } from "./domain/order-security.mjs";
import { buildCustomerTrackingView, validateTrackingToken } from "./domain/order-tracking.mjs";
import { hashGuestSessionCredential, isGuestSessionRecordValid } from "./domain/guest-session.mjs";

function fail(code, message) { throw new HttpsError(code, message); }
function onlyKeys(data, allowed) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !allowed.includes(key))) fail("invalid-argument", "Tracking request is invalid.");
}

/** A 256-bit bearer token is required. Order IDs alone reveal nothing. */
export const getGuestOrderTracking = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) fail("invalid-argument", "This endpoint is for guest orders.");
    onlyKeys(request.data, ["trackingToken"]);
    let tokenHash;
    try { tokenHash = validateTrackingToken(request.data.trackingToken); }
    catch { fail("not-found", "Order tracking details were not found."); }
    const db = getFirestore();
    const trackingSnap = await db.collection("orderTracking").doc(tokenHash).get();
    if (!trackingSnap.exists) fail("not-found", "Order tracking details were not found.");
    const tracking = trackingSnap.data();
    if (typeof tracking.orderId !== "string") fail("not-found", "Order tracking details were not found.");
    const orderSnap = await db.collection("orders").doc(tracking.orderId).get();
    if (!orderSnap.exists || orderSnap.data().trackingTokenHash !== tokenHash) {
      fail("not-found", "Order tracking details were not found.");
    }
    try {
      return { success: true, tracking: buildCustomerTrackingView({ order: orderSnap.data(), tracking }) };
    } catch {
      fail("failed-precondition", "Tracking is temporarily unavailable for this order.");
    }
  }
);

/** Rotate a lost token while the original guest checkout session remains valid. */
export const recoverGuestOrderTracking = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) fail("invalid-argument", "This endpoint is for guest orders.");
    onlyKeys(request.data, ["sessionToken", "orderId"]);
    if (typeof request.data.sessionToken !== "string" ||
        typeof request.data.orderId !== "string" ||
        !/^[A-Za-z0-9_.-]{1,128}$/.test(request.data.orderId)) {
      fail("invalid-argument", "A valid checkout session and order ID are required.");
    }
    let sessionHash;
    try { sessionHash = hashGuestSessionCredential(request.data.sessionToken); }
    catch { fail("unauthenticated", "Checkout recovery session is invalid or expired."); }
    const db = getFirestore();
    const sessionRef = db.collection("guestSessions").doc(sessionHash);
    const orderRef = db.collection("orders").doc(request.data.orderId);
    const now = Date.now();
    try {
      return await db.runTransaction(async tx => {
        const [sessionSnap, orderSnap] = await Promise.all([tx.get(sessionRef), tx.get(orderRef)]);
        if (!sessionSnap.exists || !isGuestSessionRecordValid({ rawToken: request.data.sessionToken, record: sessionSnap.data(), now })) {
          fail("unauthenticated", "Checkout recovery session is invalid or expired.");
        }
        if (!orderSnap.exists || orderSnap.data().guestSessionHash !== sessionHash) {
          fail("not-found", "This order cannot be recovered with this checkout session.");
        }
        const order = orderSnap.data();
        const oldHash = order.trackingTokenHash;
        const oldRef = typeof oldHash === "string" && /^[a-f0-9]{64}$/.test(oldHash)
          ? db.collection("orderTracking").doc(oldHash) : null;
        const next = createTrackingCredential();
        const nextRef = db.collection("orderTracking").doc(next.tokenHash);
        const oldSnap = oldRef ? await tx.get(oldRef) : null;
        const currentTracking = oldSnap?.exists ? oldSnap.data() : {
          orderId: order.orderId, status: order.status,
          paymentStatus: order.paymentStatus, fulfilmentStatus: order.fulfilmentStatus
        };
        if (oldRef && oldSnap?.exists) tx.delete(oldRef);
        tx.create(nextRef, { ...currentTracking, orderId: order.orderId, createdAtMillis: now, updatedAtMillis: now });
        tx.update(orderRef, { trackingTokenHash: next.tokenHash, updatedAtMillis: now });
        return { success: true, orderId: order.orderId, trackingToken: next.rawToken };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("recoverGuestOrderTracking failed", error);
      throw new HttpsError("internal", "Could not recover order tracking.");
    }
  }
);
