import { hashTrackingCredential } from "./order-security.mjs";

const ORDER_STATES = new Set(["awaiting_confirmation", "confirmed", "rejected", "cancelled", "fulfilled"]);
const PAYMENT_STATES = new Set(["unpaid", "pending", "paid", "partially_paid", "refunded", "failed"]);
const FULFILMENT_STATES = new Set(["unfulfilled", "processing", "ready_for_pickup", "dispatched", "delivered", "fulfilled", "cancelled"]);

export function validateTrackingToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    const error = new TypeError("A valid tracking token is required");
    error.code = "INVALID_TRACKING_TOKEN";
    throw error;
  }
  return hashTrackingCredential(token);
}

/** Customer-safe projection. Never return customer contacts, address, notes or internal stock data. */
export function buildCustomerTrackingView({ order, tracking }) {
  if (!order || !tracking || typeof order !== "object" || typeof tracking !== "object" ||
      typeof order.orderId !== "string" || tracking.orderId !== order.orderId) {
    throw new TypeError("Tracking record does not match an order");
  }
  if (!ORDER_STATES.has(order.status) || !PAYMENT_STATES.has(order.paymentStatus) ||
      !FULFILMENT_STATES.has(order.fulfilmentStatus)) {
    throw new TypeError("Order contains an unsupported tracking state");
  }
  const timeline = [{
    event: "order_placed",
    status: "Order received",
    atMillis: Number.isSafeInteger(order.createdAtMillis) ? order.createdAtMillis : null
  }];
  if (Number.isSafeInteger(order.confirmedAtMillis)) timeline.push({ event: "confirmed", status: "Order confirmed", atMillis: order.confirmedAtMillis });
  if (Number.isSafeInteger(order.rejectedAtMillis)) timeline.push({ event: "rejected", status: "Order could not be accepted", atMillis: order.rejectedAtMillis });
  if (Number.isSafeInteger(order.fulfilledAtMillis)) timeline.push({ event: "fulfilled", status: "Order fulfilled", atMillis: order.fulfilledAtMillis });
  if (Number.isSafeInteger(order.cancelledAtMillis)) timeline.push({ event: "cancelled", status: "Order cancelled", atMillis: order.cancelledAtMillis });
  timeline.sort((a, b) => (a.atMillis ?? 0) - (b.atMillis ?? 0));
  return {
    orderId: order.orderId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfilmentStatus: order.fulfilmentStatus,
    currency: order.currency === "NGN" ? "NGN" : "NGN",
    grandTotalMinor: Number.isSafeInteger(order.grandTotalMinor) ? order.grandTotalMinor : null,
    createdAtMillis: Number.isSafeInteger(order.createdAtMillis) ? order.createdAtMillis : null,
    updatedAtMillis: Number.isSafeInteger(order.updatedAtMillis) ? order.updatedAtMillis : null,
    timeline
  };
}
