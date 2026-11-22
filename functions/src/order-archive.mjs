import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const MAX_RANGE = 90 * 24 * 60 * 60 * 1000;
const PAGE_SCAN = 250;
const PAGE_SIZE = 50;

function fail(code, message) { throw new HttpsError(code, message); }

export const listCommerceOrderArchive = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) fail("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (!["owner", "order_manager", "delivery_manager", "payment_manager"].includes(role)) {
      fail("permission-denied", "Authorized order, delivery or payment staff access is required.");
    }
    const data = request.data || {};
    if (Object.keys(data).some(key => !["fromMillis", "toMillis", "cursor"].includes(key)) ||
        !Number.isSafeInteger(data.fromMillis) || !Number.isSafeInteger(data.toMillis) ||
        data.fromMillis < 0 || data.toMillis <= data.fromMillis ||
        data.toMillis - data.fromMillis > MAX_RANGE) {
      fail("invalid-argument", "Choose a valid date range of 90 days or less.");
    }
    let cursor = null;
    if (data.cursor != null) {
      if (!data.cursor || !Number.isSafeInteger(data.cursor.createdAtMillis) ||
          typeof data.cursor.id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(data.cursor.id)) {
        fail("invalid-argument", "Archive page cursor is invalid.");
      }
      cursor = data.cursor;
    }
    const db = getFirestore();
    let query = db.collection("orders")
      .where("createdAtMillis", ">=", data.fromMillis)
      .where("createdAtMillis", "<=", data.toMillis)
      .orderBy("createdAtMillis", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(PAGE_SCAN);
    if (cursor) query = query.startAfter(cursor.createdAtMillis, cursor.id);
    const snapshot = await query.get();
    const archived = snapshot.docs.filter(doc => {
      const d = doc.data();
      return d.status === "rejected" || d.fulfilmentStatus === "fulfilled";
    }).slice(0, PAGE_SIZE);
    const orders = archived.map(doc => {
      const d = doc.data();
      const privacyLimited = role === "payment_manager";
      return {
        id: doc.id,
        status: d.status || "unknown",
        fulfilmentStatus: d.fulfilmentStatus || "unfulfilled",
        createdAtMillis: d.createdAtMillis,
        customer: privacyLimited ? {} : { name: d.customer?.name || "", phone: d.customer?.phone || "" },
        fulfilment: privacyLimited ? { method: d.fulfilment?.method || "" } : {
          method: d.fulfilment?.method || "", area: d.fulfilment?.area || ""
        },
        lines: Array.isArray(d.lines) ? d.lines.map(line => ({
          name: line.productName || line.name || line.productId || "Item",
          quantity: line.quantity
        })) : [],
        grandTotalMinor: Number.isSafeInteger(d.grandTotalMinor) ? d.grandTotalMinor : 0,
        paymentTotalMinor: Number.isSafeInteger(d.paymentTotalMinor) ? d.paymentTotalMinor : 0,
        paymentStatus: d.paymentStatus || "unpaid"
      };
    });
    const last = snapshot.docs.at(-1);
    return {
      orders,
      hasMore: snapshot.size === PAGE_SCAN,
      cursor: last ? { createdAtMillis: last.data().createdAtMillis, id: last.id } : null,
      scanned: snapshot.size,
      privacyLimited: role === "payment_manager"
    };
  }
);
