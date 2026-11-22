import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export const listPendingCommerceOrders = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "order_manager" && role !== "delivery_manager") {
      throw new HttpsError("permission-denied", "Order or delivery manager access is required.");
    }
    const db = getFirestore();
    const [pending, confirmed] = await Promise.all([
      db.collection("orders").where("status", "==", "awaiting_confirmation").limit(500).get(),
      db.collection("orders").where("status", "==", "confirmed").limit(500).get()
    ]);
    const docs = [...pending.docs, ...confirmed.docs].filter(doc =>
      role !== "delivery_manager" || doc.data().fulfilment?.method === "delivery"
    );
    const orders = docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id, status: d.status, fulfilmentStatus: d.fulfilmentStatus || "unfulfilled",
        customer: d.customer || {}, fulfilment: d.fulfilment || {},
        lines: Array.isArray(d.lines) ? d.lines : [],
        subtotalMinor: d.subtotalMinor ?? 0, discountMinor: d.discountMinor ?? 0,
        deliveryFeeMinor: d.deliveryFeeMinor ?? 0, grandTotalMinor: d.grandTotalMinor ?? 0,
        currency: d.currency || "NGN", createdAtMillis: d.createdAtMillis ?? null,
        note: d.note || "", paymentStatus: d.paymentStatus || "unpaid"
      };
    }).sort((a,b)=>(b.createdAtMillis||0)-(a.createdAtMillis||0));
    return { orders: orders.slice(0, 100), limited: pending.size === 500 || confirmed.size === 500 };
  }
);
