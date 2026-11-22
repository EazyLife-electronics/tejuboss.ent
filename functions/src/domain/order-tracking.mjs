import { hashTrackingCredential } from "./order-security.mjs";

const ORDER_STATES = new Set(["awaiting_confirmation", "confirmed", "rejected", "cancelled", "fulfilled"]);
const PAYMENT_STATES = new Set(["unpaid", "pending", "paid", "partially_paid", "refunded", "failed"]);
const FULFILMENT_STATES = new Set(["unfulfilled", "preparing", "processing", "ready_for_pickup", "dispatched", "delivered", "fulfilled", "cancelled"]);

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
      typeof order.orderId !== "string" || tracking.orderId !== order.orderId) throw new TypeError("Tracking record does not match an order");
  if (!ORDER_STATES.has(order.status) || !PAYMENT_STATES.has(order.paymentStatus) || !FULFILMENT_STATES.has(order.fulfilmentStatus)) {
    throw new TypeError("Order contains an unsupported tracking state");
  }
  const events = [
    ["createdAtMillis", "order_placed", "Order received"],
    ["confirmedAtMillis", "confirmed", "Order confirmed"],
    ["preparingAtMillis", "preparing", "Order is being prepared"],
    ["readyForPickupAtMillis", "ready_for_pickup", "Ready for pickup"],
    ["dispatchedAtMillis", "dispatched", "Order dispatched"],
    ["fulfilledAtMillis", "fulfilled", order.fulfilment?.method === "pickup" ? "Order collected" : "Order delivered"],
    ["rejectedAtMillis", "rejected", "Order could not be accepted"],
    ["cancelledAtMillis", "cancelled", "Order cancelled"]
  ];
  const timeline = events.filter(([field]) => Number.isSafeInteger(order[field]))
    .map(([field, event, status]) => ({ event, status, atMillis: order[field] }))
    .sort((a,b)=>(a.atMillis??0)-(b.atMillis??0));
  return {
    orderId: order.orderId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfilmentStatus: order.fulfilmentStatus,
    currency: "NGN",
    grandTotalMinor: Number.isSafeInteger(order.grandTotalMinor) ? order.grandTotalMinor : null,
    createdAtMillis: Number.isSafeInteger(order.createdAtMillis) ? order.createdAtMillis : null,
    updatedAtMillis: Number.isSafeInteger(order.updatedAtMillis) ? order.updatedAtMillis : null,
    timeline
  };
}
