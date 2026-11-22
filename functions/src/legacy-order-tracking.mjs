import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

function fail(code, message) { throw new HttpsError(code, message); }

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  return null;
}

/**
 * Compatibility lookup for pre-secure-checkout orders.
 * A legacy tracking code is paired with the last four digits of the order
 * phone number. Only customer-facing fields are returned; private order and
 * delivery documents remain server-side.
 */
export const getLegacyOrderTracking = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) fail("invalid-argument", "This endpoint is for guest order tracking.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some(key => !["trackingCode", "phoneLast4"].includes(key))) {
      fail("invalid-argument", "Tracking request is invalid.");
    }

    const trackingCode = typeof data.trackingCode === "string" ? data.trackingCode.trim().toUpperCase() : "";
    const phoneLast4 = typeof data.phoneLast4 === "string" ? data.phoneLast4.replace(/\D/g, "") : "";
    if (!/^TB-[A-HJ-NP-Z2-9]{6}$/.test(trackingCode) || !/^\d{4}$/.test(phoneLast4)) {
      fail("invalid-argument", "Enter a valid tracking code and the last four digits of the order phone number.");
    }

    const db = getFirestore();
    const orderSnap = await db.collection("orders").doc(trackingCode).get();
    if (!orderSnap.exists) fail("not-found", "Order tracking details were not found.");
    const order = orderSnap.data();
    // Never allow this compatibility endpoint to expose the newer private schema.
    if (order.source === "guest" || order.schemaVersion === 1 && order.orderId) {
      fail("not-found", "Order tracking details were not found.");
    }

    const storedPhone = normalizePhone(order.phone ?? order.customerPhone ?? order.customer?.phone);
    if (storedPhone.length < 4 || storedPhone.slice(-4) !== phoneLast4) {
      fail("not-found", "Order tracking details were not found.");
    }

    let delivery = null;
    if (typeof order.deliveryId === "string" && order.deliveryId.length <= 128) {
      const deliverySnap = await db.collection("deliveries").doc(order.deliveryId).get();
      if (deliverySnap.exists) {
        const record = deliverySnap.data();
        const allowedStatuses = new Set(["assigned", "picked_up", "in_transit", "checkpoint", "delivered", "failed", "returned"]);
        if (allowedStatuses.has(record.status)) {
          delivery = {
            status: record.status,
            deliveryType: typeof record.deliveryType === "string" ? record.deliveryType.slice(0, 60) : null,
            lastCheckpointName: typeof record.lastCheckpointName === "string" ? record.lastCheckpointName.slice(0, 100) : null
          };
        }
      }
    }

    const items = Array.isArray(order.items) ? order.items.slice(0, 100).map(item => ({
      name: typeof item?.name === "string" ? item.name.slice(0, 160) : "Item",
      variant: typeof item?.variant === "string" ? item.variant.slice(0, 100) : "",
      quantity: Number.isFinite(Number(item?.quantity)) ? Math.max(0, Number(item.quantity)) : 0
    })) : [];

    const createdAtMillis = timestampMillis(order.createdAt);
    return {
      success: true,
      tracking: {
        trackingCode,
        status: typeof order.status === "string" ? order.status : "new",
        items,
        total: Number.isFinite(Number(order.total)) ? Number(order.total) : 0,
        createdAtMillis,
        cancelReason: typeof order.cancelReason === "string" ? order.cancelReason : null,
        cancelCustomerNote: typeof order.cancelCustomerNote === "string" ? order.cancelCustomerNote.slice(0, 300) : null,
        delivery
      }
    };
  }
);
