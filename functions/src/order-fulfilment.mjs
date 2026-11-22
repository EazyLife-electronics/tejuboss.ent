import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const TRANSITIONS = {
  unfulfilled: ["preparing"],
  preparing: ["ready_for_pickup", "dispatched"],
  ready_for_pickup: ["fulfilled"],
  dispatched: ["fulfilled"]
};

function fail(code, message) { throw new HttpsError(code, message); }

export const updateOrderFulfilment = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) fail("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some(key => !["orderId", "nextStatus", "expectedStatus"].includes(key)) ||
        typeof data.orderId !== "string" || !ID.test(data.orderId) ||
        typeof data.nextStatus !== "string" || typeof data.expectedStatus !== "string") {
      fail("invalid-argument", "A valid order ID and expected/current fulfilment statuses are required.");
    }
    const firestore = getFirestore();
    const orderRef = firestore.collection("orders").doc(data.orderId);
    const auditRef = firestore.collection("auditLogs").doc();
    const now = Date.now();
    try {
      return await firestore.runTransaction(async tx => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) fail("not-found", "Order was not found.");
        const order = snap.data();
        if (order.status !== "confirmed") fail("failed-precondition", "Only confirmed orders can move through fulfilment.");
        const method = order.fulfilment?.method;
        if (!["pickup", "delivery"].includes(method)) fail("failed-precondition", "Order has no supported fulfilment method.");
        const current = order.fulfilmentStatus || "unfulfilled";
        if (current !== data.expectedStatus) fail("aborted", "This order changed since it was loaded. Refresh the queue.");
        if (!(TRANSITIONS[current] || []).includes(data.nextStatus)) fail("failed-precondition", "That fulfilment transition is not allowed.");
        if (data.nextStatus === "ready_for_pickup" && method !== "pickup") fail("failed-precondition", "Only pickup orders can be marked ready for pickup.");
        if (data.nextStatus === "dispatched" && method !== "delivery") fail("failed-precondition", "Only delivery orders can be dispatched.");
        if (role !== "owner" && role !== "order_manager" && !(role === "delivery_manager" && method === "delivery")) {
          fail("permission-denied", "Order or delivery manager access is required.");
        }
        const trackingHash = order.trackingTokenHash;
        const trackingRef = typeof trackingHash === "string" && /^[a-f0-9]{64}$/.test(trackingHash)
          ? firestore.collection("orderTracking").doc(trackingHash) : null;
        const trackingSnap = trackingRef ? await tx.get(trackingRef) : null;
        const timestampField = {
          preparing: "preparingAtMillis",
          ready_for_pickup: "readyForPickupAtMillis",
          dispatched: "dispatchedAtMillis",
          fulfilled: "fulfilledAtMillis"
        }[data.nextStatus];
        tx.update(orderRef, {
          fulfilmentStatus: data.nextStatus,
          [timestampField]: now,
          updatedAtMillis: now,
          fulfilmentUpdatedBy: request.auth.uid
        });
        if (trackingRef && trackingSnap?.exists) {
          tx.update(trackingRef, { fulfilmentStatus: data.nextStatus, updatedAtMillis: now });
        }
        tx.create(auditRef, {
          action: "order_fulfilment_updated",
          entityType: "order",
          entityId: data.orderId,
          fromStatus: current,
          toStatus: data.nextStatus,
          actorUid: request.auth.uid,
          actorRole: role,
          createdAt: FieldValue.serverTimestamp()
        });
        return { success: true, orderId: data.orderId, previousStatus: current, fulfilmentStatus: data.nextStatus };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("updateOrderFulfilment failed", error);
      throw new HttpsError("internal", "Could not update order fulfilment.");
    }
  }
);
