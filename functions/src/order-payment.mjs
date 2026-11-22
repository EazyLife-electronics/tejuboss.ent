import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const KEY = /^[A-Za-z0-9_-]{16,100}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw new HttpsError(code, message); };

function validate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !["orderId", "amountMinor", "method", "reference", "idempotencyKey"].includes(key))) {
    fail("invalid-argument", "Payment request contains unsupported fields.");
  }
  if (typeof data.orderId !== "string" || !ID.test(data.orderId)) fail("invalid-argument", "Order ID is invalid.");
  if (!Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0) fail("invalid-argument", "Payment amount must be a positive integer in kobo.");
  if (typeof data.method !== "string" || data.method.trim().length < 2 || data.method.trim().length > 40) {
    fail("invalid-argument", "Enter a payment method between 2 and 40 characters.");
  }
  if (data.reference !== undefined && (typeof data.reference !== "string" || data.reference.length > 100)) {
    fail("invalid-argument", "Payment reference must be 100 characters or fewer.");
  }
  if (typeof data.idempotencyKey !== "string" || !KEY.test(data.idempotencyKey)) {
    fail("invalid-argument", "A valid payment submission key is required.");
  }
  return { ...data, method: data.method.trim(), reference: (data.reference || "").trim() };
}

/** Staff-recorded payment entry. This records a receipt; it does not contact a bank or payment gateway. */
export const recordOrderPayment = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) fail("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "payment_manager") fail("permission-denied", "Payment manager access is required.");
    const input = validate(request.data);
    const db = getFirestore();
    const orderRef = db.collection("orders").doc(input.orderId);
    const paymentId = hash(input.idempotencyKey);
    const paymentRef = orderRef.collection("payments").doc(paymentId);
    const auditRef = db.collection("auditLogs").doc();
    const now = Date.now();
    try {
      return await db.runTransaction(async tx => {
        const [orderSnap, paymentSnap] = await Promise.all([tx.get(orderRef), tx.get(paymentRef)]);
        if (!orderSnap.exists) fail("not-found", "Order was not found.");
        if (paymentSnap.exists) {
          const old = paymentSnap.data();
          if (old.amountMinor !== input.amountMinor || old.method !== input.method || old.reference !== input.reference) {
            fail("already-exists", "This payment submission key was already used for different details.");
          }
          return { success: true, outcome: "already_recorded", paymentId, paymentStatus: old.paymentStatusAfter, paidTotalMinor: old.paidTotalAfterMinor };
        }
        const order = orderSnap.data();
        if (order.status !== "confirmed") fail("failed-precondition", "Payments can only be recorded for confirmed orders.");
        const total = order.grandTotalMinor;
        const previousPaid = order.paymentTotalMinor ?? 0;
        if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(previousPaid) || previousPaid < 0 || previousPaid > total) {
          fail("failed-precondition", "Order payment totals need reconciliation before another receipt can be recorded.");
        }
        const trackingRef = typeof order.trackingTokenHash === "string" && /^[a-f0-9]{64}$/.test(order.trackingTokenHash)
          ? db.collection("orderTracking").doc(order.trackingTokenHash) : null;
        const trackingSnap = trackingRef ? await tx.get(trackingRef) : null;
        const remaining = total - previousPaid;
        if (input.amountMinor > remaining) fail("failed-precondition", "Payment exceeds the outstanding order balance.");
        const paidTotal = previousPaid + input.amountMinor;
        const paymentStatus = paidTotal === total ? "paid" : "partially_paid";
        tx.create(paymentRef, {
          amountMinor: input.amountMinor,
          method: input.method,
          reference: input.reference || null,
          receivedAtMillis: now,
          receivedBy: request.auth.uid,
          paymentStatusAfter: paymentStatus,
          paidTotalAfterMinor: paidTotal,
          createdAt: FieldValue.serverTimestamp()
        });
        tx.update(orderRef, {
          paymentTotalMinor: paidTotal,
          paymentStatus,
          paymentUpdatedAtMillis: now,
          updatedAtMillis: now
        });
        tx.create(auditRef, {
          action: "order_payment_recorded",
          entityType: "order",
          entityId: input.orderId,
          paymentId,
          amountMinor: input.amountMinor,
          method: input.method,
          actorUid: request.auth.uid,
          actorRole: role,
          createdAt: FieldValue.serverTimestamp()
        });
        return { success: true, outcome: "recorded", paymentId, paymentStatus, paidTotalMinor: paidTotal, outstandingMinor: total - paidTotal };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("recordOrderPayment failed", error);
      throw new HttpsError("internal", "Could not record this payment.");
    }
  }
);


/** Read-only receipt history for owner/payment staff; never exposes staff UIDs. */
export const listOrderPaymentHistory = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) fail("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "payment_manager") fail("permission-denied", "Payment manager access is required.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some(key => key !== "orderId") ||
        typeof data.orderId !== "string" || !ID.test(data.orderId)) {
      fail("invalid-argument", "A valid orderId is required.");
    }
    const db = getFirestore();
    const orderRef = db.collection("orders").doc(data.orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) fail("not-found", "Order was not found.");
    const order = orderSnap.data();
    const snapshot = await orderRef.collection("payments").orderBy("receivedAtMillis", "asc").limit(201).get();
    const all = snapshot.docs.map(doc => {
      const p = doc.data();
      return {
        paymentId: doc.id,
        amountMinor: Number.isSafeInteger(p.amountMinor) ? p.amountMinor : 0,
        method: typeof p.method === "string" ? p.method : "Unspecified",
        reference: typeof p.reference === "string" ? p.reference : "",
        receivedAtMillis: Number.isSafeInteger(p.receivedAtMillis) ? p.receivedAtMillis : 0,
        paymentStatusAfter: typeof p.paymentStatusAfter === "string" ? p.paymentStatusAfter : "",
        paidTotalAfterMinor: Number.isSafeInteger(p.paidTotalAfterMinor) ? p.paidTotalAfterMinor : 0
      };
    }).sort((a, b) => a.receivedAtMillis - b.receivedAtMillis || a.paymentId.localeCompare(b.paymentId));
    return {
      orderId: data.orderId,
      grandTotalMinor: Number.isSafeInteger(order.grandTotalMinor) ? order.grandTotalMinor : 0,
      paymentTotalMinor: Number.isSafeInteger(order.paymentTotalMinor) ? order.paymentTotalMinor : 0,
      paymentStatus: typeof order.paymentStatus === "string" ? order.paymentStatus : "unpaid",
      payments: all.slice(0, 200),
      limited: all.length > 200
    };
  }
);
