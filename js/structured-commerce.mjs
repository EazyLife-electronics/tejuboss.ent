// Structured guest commerce adapter. Additive: the legacy shop/store modules remain untouched.
import { initFirebase } from "./firebase.mjs";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { app } = initFirebase();
const functions = getFunctions(app, "europe-west1");
const call = name => httpsCallable(functions, name);
const SESSION_KEY = "tejuboss.structuredGuestSession.v1";
const PENDING_KEY = "tejuboss.structuredPendingOrder.v1";
const TRACKING_KEY = "tejuboss.structuredTracking.v1";

function randomKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function readJson(storage, key) {
  try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; }
}
function writeJson(storage, key, value) { storage.setItem(key, JSON.stringify(value)); }

async function guestSession() {
  const current = readJson(sessionStorage, SESSION_KEY);
  if (current?.sessionToken && Number.isSafeInteger(current.expiresAtMillis) &&
      current.expiresAtMillis > Date.now() + 30_000) return current;
  const response = await call("createGuestCheckoutSession")({});
  const session = response.data;
  if (!session?.sessionToken || !Number.isSafeInteger(session.expiresAtMillis)) {
    throw new Error("Could not start a secure guest checkout session.");
  }
  writeJson(sessionStorage, SESSION_KEY, session);
  return session;
}

/** Returns safe public delivery areas. Fee totals are always revalidated by the server. */
export async function getStructuredDeliveryOptions() {
  const response = await call("getPublicDeliveryOptions")({});
  return response.data;
}

/**
 * Submit only stable catalogue IDs and quantities. No browser prices or totals
 * are sent. An identical retry reuses its idempotency key.
 */
export async function submitStructuredGuestOrder({ items, customer, fulfilment, note = "" }) {
  const cleanPayload = { items, customer, fulfilment, note };
  if (!Array.isArray(items) || !items.length) throw new Error("Your cart is empty.");
  let pending = readJson(sessionStorage, PENDING_KEY);
  if (!pending || pending.fingerprint !== stable(cleanPayload)) {
    pending = { fingerprint: stable(cleanPayload), idempotencyKey: randomKey(), payload: cleanPayload };
    writeJson(sessionStorage, PENDING_KEY, pending);
  }
  const session = await guestSession();
  let response = await call("createGuestOrder")({
    sessionToken: session.sessionToken,
    order: { ...pending.payload, idempotencyKey: pending.idempotencyKey }
  });
  let result = response.data;
  if (result?.outcome === "replay" && result.orderId && !result.trackingToken) {
    const recovered = await call("recoverGuestOrderTracking")({
      sessionToken: session.sessionToken,
      orderId: result.orderId
    });
    result = { ...result, trackingToken: recovered.data.trackingToken };
  }
  if (!result?.success || !result.orderId || !result.trackingToken) {
    throw new Error("The order response was incomplete. Keep this page open and retry safely.");
  }
  const saved = readJson(localStorage, TRACKING_KEY) || [];
  const next = [{ orderId: result.orderId, trackingToken: result.trackingToken, savedAtMillis: Date.now() },
    ...saved.filter(entry => entry.orderId !== result.orderId)].slice(0, 20);
  writeJson(localStorage, TRACKING_KEY, next);
  sessionStorage.removeItem(PENDING_KEY);
  return result;
}

export async function getStructuredOrderTracking(trackingToken) {
  const response = await call("getGuestOrderTracking")({ trackingToken });
  return response.data.tracking;
}

/** Recover a token only for an order created by this still-valid browser session. */
export async function recoverStructuredOrderTracking(orderId) {
  const session = await guestSession();
  const response = await call("recoverGuestOrderTracking")({
    sessionToken: session.sessionToken,
    orderId
  });
  const saved = readJson(localStorage, TRACKING_KEY) || [];
  const next = [{ orderId, trackingToken: response.data.trackingToken, savedAtMillis: Date.now() },
    ...saved.filter(entry => entry.orderId !== orderId)].slice(0, 20);
  writeJson(localStorage, TRACKING_KEY, next);
  return response.data.trackingToken;
}

export function getSavedStructuredTrackingOrders() {
  return readJson(localStorage, TRACKING_KEY) || [];
}
