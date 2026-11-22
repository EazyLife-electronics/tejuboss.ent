import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
function role(request, allowed) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Staff sign-in is required.");
  if (!allowed.includes(request.auth.token.role)) throw new HttpsError("permission-denied", "You do not have access to this order operation.");
}
function cleanOrder(snap) {
  const data = snap.data() || {};
  return { id: snap.id, ...data };
}

export const listLegacyOrders = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    role(request, ["owner", "order_manager", "payment_manager"]);
    const data = request.data ?? {};
    if (Object.keys(data).some(key => key !== "limit" && key !== "beforeMillis")) {
      throw new HttpsError("invalid-argument", "Unsupported order-list filter.");
    }
    const limit = Number.isSafeInteger(data.limit) ? Math.max(1, Math.min(data.limit, 100)) : 60;
    let query = getFirestore().collection("orders").orderBy("createdAt", "desc").limit(limit);
    if (Number.isSafeInteger(data.beforeMillis) && data.beforeMillis > 0) {
      query = query.startAfter(new Date(data.beforeMillis));
    }
    const snapshot = await query.get();
    return { orders: snapshot.docs.map(cleanOrder), count: snapshot.size };
  }
);

export const linkLegacyOrderDelivery = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    role(request, ["owner", "order_manager", "delivery_manager"]);
    const data = request.data ?? {};
    if (Object.keys(data).some(key => !["orderId", "deliveryId"].includes(key)) ||
        typeof data.orderId !== "string" || !ID.test(data.orderId) ||
        typeof data.deliveryId !== "string" || !ID.test(data.deliveryId)) {
      throw new HttpsError("invalid-argument", "Order and delivery IDs are required.");
    }
    const db = getFirestore();
    const orderRef = db.collection("orders").doc(data.orderId);
    const deliveryRef = db.collection("deliveries").doc(data.deliveryId);
    const auditRef = db.collection("auditLogs").doc();
    return db.runTransaction(async tx => {
      const [order, delivery] = await Promise.all([tx.get(orderRef), tx.get(deliveryRef)]);
      if (!order.exists) throw new HttpsError("not-found", "Order was not found.");
      if (!delivery.exists) throw new HttpsError("not-found", "Delivery record was not found.");
      const oldDeliveryId = order.data().deliveryId || null;
      if (oldDeliveryId === data.deliveryId) return { success: true, outcome: "unchanged" };
      tx.update(orderRef, { deliveryId: data.deliveryId, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid });
      tx.create(auditRef, {
        action: "legacy_order_delivery_linked", entityType: "legacy_order", entityId: data.orderId,
        previousDeliveryId: oldDeliveryId, deliveryId: data.deliveryId,
        actorUid: request.auth.uid, actorRole: request.auth.token.role,
        createdAt: FieldValue.serverTimestamp()
      });
      return { success: true, outcome: "linked", orderId: data.orderId, deliveryId: data.deliveryId };
    });
  }
);
