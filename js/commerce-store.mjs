// Spark-compatible commerce data layer for the clean TejuBoss schema.
// Browser-submitted quotes are unverified. This module never deducts stock
// during guest checkout and never treats client prices as authoritative.

import { initFirebase } from "./firebase.mjs";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const { db, auth } = initFirebase();
const ADMIN_EMAIL = "damzyeazy@gmail.com";
const isAdmin = () => auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL;

function requireAdmin() {
  if (!isAdmin()) throw new Error("Administrator sign-in is required.");
}
function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map(value => value.toString(16).padStart(2, "0")).join("");
}
function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}
function toMinor(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000000) {
    throw new Error("A displayed price is invalid. Refresh the catalogue and try again.");
  }
  return Math.round(number * 100);
}

export async function getPublicSiteSettings() {
  const snap = await getDoc(doc(db, "siteSettings", "public"));
  if (!snap.exists()) return {};
  const value = snap.data();
  return {
    whatsapp: cleanText(value.whatsapp, 20),
    tagline: cleanText(value.tagline, 180),
    aboutText: cleanText(value.aboutText, 3000),
    deliveryFeePerItem: Number.isSafeInteger(value.deliveryFeeMinor) && value.deliveryFeeMinor >= 0
      ? value.deliveryFeeMinor / 100 : null
  };
}

export async function listPublicCatalogue() {
  const snap = await getDocs(query(
    collection(db, "catalogueProducts"),
    where("published", "==", true),
    limit(200)
  ));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listAdminCatalogue() {
  requireAdmin();
  const snap = await getDocs(query(collection(db, "catalogueProducts"), limit(500)));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function saveCatalogueProduct(product, productId = null) {
  requireAdmin();
  const name = cleanText(product?.name, 160);
  if (!name) throw new Error("Product name is required.");
  const options = Array.isArray(product.sellingOptions) ? product.sellingOptions : [];
  if (!options.length || options.length > 50) throw new Error("Add between 1 and 50 selling options.");
  const normalizedOptions = options.map((option, index) => {
    const id = cleanText(option.id || randomHex(8), 80);
    const rawMinor = option.priceMinor != null ? Number(option.priceMinor) : Math.round(Number(option.price || 0) * 100);
    if (!Number.isSafeInteger(rawMinor) || rawMinor < 0 || rawMinor > 10000000000) throw new Error("A product option price is invalid.");
    const priceMinor = rawMinor;
    return {
      id,
      label: cleanText(option.label || `Option ${index + 1}`, 100),
      sku: cleanText(option.sku, 80),
      priceMinor,
      currency: "NGN",
      enabled: option.enabled !== false
    };
  });
  const payload = {
    schemaVersion: 1,
    name,
    slug: cleanText(product.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 180),
    description: cleanText(product.description, 3000),
    brand: cleanText(product.brand, 100),
    categoryId: cleanText(product.categoryId || product.category, 100),
    images: (Array.isArray(product.images) ? product.images : []).slice(0, 12).map((image, index) => ({
      url: cleanText(typeof image === "string" ? image : image.url, 1500),
      alt: cleanText(typeof image === "string" ? name : image.alt || name, 180),
      sortOrder: index
    })).filter(image => image.url),
    sellingOptions: normalizedOptions,
    published: product.published === true,
    availability: product.availability === "unavailable" ? "unavailable" : "available",
    updatedAt: serverTimestamp()
  };
  if (productId) {
    await updateDoc(doc(db, "catalogueProducts", productId), payload);
    return productId;
  }
  const ref = doc(collection(db, "catalogueProducts"));
  await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteCatalogueProduct(productId) {
  requireAdmin();
  await deleteDoc(doc(db, "catalogueProducts", productId));
}

export async function submitGuestOrderRequest(input) {
  const name = cleanText(input.customerName, 100);
  const phone = cleanText(input.phone, 20);
  const address = cleanText(input.address, 500);
  if (name.length < 1 || phone.length < 7) throw new Error("Enter your name and a valid phone number.");
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  if (!sourceItems.length || sourceItems.length > 30) throw new Error("Your order must contain between 1 and 30 items.");

  const lines = sourceItems.map(item => {
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new Error("One or more item quantities are invalid.");
    }
    return {
      productId: cleanText(item.productId, 128),
      sellingOptionId: cleanText(item.variantId, 128),
      requestedName: cleanText(item.name, 160),
      requestedOption: cleanText(item.variant, 120),
      requestedAddons: Array.isArray(item.upgrades) ? item.upgrades.slice(0, 10).map(value => cleanText(value, 100)) : [],
      quantity,
      displayedUnitPriceMinor: toMinor(item.price)
    };
  });
  if (lines.some(line => !line.productId || !line.sellingOptionId)) {
    throw new Error("A selected item is missing its catalogue reference. Refresh the shop and try again.");
  }

  const subtotalMinor = toMinor(input.subtotal);
  const deliveryFeeMinor = toMinor(input.deliveryFee);
  const grandTotalMinor = toMinor(input.total);
  const orderRef = doc(collection(db, "orders"));
  const trackingToken = randomHex(16);
  const now = serverTimestamp();
  const fulfilment = {
    method: cleanText(input.fulfilmentMethod || "delivery", 20) === "pickup" ? "pickup" : "delivery",
    address,
    city: cleanText(input.city, 100),
    state: cleanText(input.state, 100),
    note: cleanText(input.deliveryNote, 500)
  };
  const batch = writeBatch(db);
  batch.set(orderRef, {
      schemaVersion: 1,
      orderId: orderRef.id,
      trackingToken,
      status: "awaiting_review",
      customer: {
        name,
        phone,
        email: cleanText(input.email, 254) || null
      },
      fulfilment,
      lines,
      quote: {
        currency: "NGN",
        subtotalMinor,
        deliveryFeeMinor,
        grandTotalMinor
      },
      quoteStatus: "unverified",
      createdAt: now,
      updatedAt: now
    });
  batch.set(doc(db, "orderTracking", trackingToken), {
    orderId: orderRef.id,
    status: "submitted",
    createdAt: now,
    updatedAt: now
  });
  await batch.commit();
  return trackingToken;
}

export async function getPublicOrderTracking(token) {
  const safeToken = String(token || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(safeToken)) throw new Error("Enter a valid tracking token.");
  const snap = await getDoc(doc(db, "orderTracking", safeToken));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { status: data.status, createdAt: data.createdAt, updatedAt: data.updatedAt };
}

export async function listOrdersForAdmin() {
  requireAdmin();
  const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function setOrderReviewDecision(orderId, decision, verification = {}) {
  requireAdmin();
  if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid order decision.");
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("Order not found.");
    const order = orderSnap.data();
    if (order.status !== "awaiting_review") throw new Error("Only orders awaiting review can be decided.");
    const trackingToken = cleanText(order.trackingToken, 64);
    const trackingRef = /^[a-f0-9]{32}$/.test(trackingToken)
      ? doc(db, "orderTracking", trackingToken)
      : null;
    const trackingSnap = trackingRef ? await transaction.get(trackingRef) : null;
    if (!trackingSnap?.exists()) throw new Error("The public tracking record is missing; no decision was saved.");
    const patch = {
      status: decision,
      quoteStatus: "staff_verified",
      staffVerification: {
        acceptedTotalMinor: decision === "approved" ? toMinor(verification.acceptedTotal) : null,
        note: cleanText(verification.note, 1000),
        verifiedBy: auth.currentUser.uid,
        verifiedAt: serverTimestamp()
      },
      updatedAt: serverTimestamp()
    };
    transaction.update(orderRef, patch);
    transaction.update(trackingRef, {
      status: decision,
      updatedAt: serverTimestamp()
    });
    return { id: orderId, status: decision };
  });
}

// Explicitly separate staff stock movements from order submission/review.
// This transaction prevents negative balances and writes the balance and
// corresponding immutable movement together.
export async function recordInventoryMovement({ balanceId, quantityDelta, movementType, reason, referenceId = "" }) {
  requireAdmin();
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) throw new Error("Enter a non-zero whole-number stock change.");
  const balanceRef = doc(db, "inventoryBalances", cleanText(balanceId, 128));
  const movementRef = doc(collection(db, "inventoryMovements"));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(balanceRef);
    if (!snapshot.exists()) throw new Error("Inventory balance has not been initialized.");
    const current = Number(snapshot.data().quantityOnHand);
    const next = current + quantityDelta;
    if (!Number.isSafeInteger(current) || next < 0) throw new Error("This movement would make stock negative.");
    transaction.update(balanceRef, {
      quantityOnHand: next,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });
    transaction.set(movementRef, {
      productId: cleanText(snapshot.data().productId, 128),
      sellingOptionId: cleanText(snapshot.data().sellingOptionId, 128),
      locationId: cleanText(snapshot.data().locationId, 128),
      quantityDelta,
      movementType: cleanText(movementType, 40) || "adjustment",
      reason: cleanText(reason, 500),
      referenceId: cleanText(referenceId, 128),
      actorUid: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });
  });
  return movementRef.id;
}


// Compatibility adapters for the existing product editor and shop markup.
// The persisted schema remains catalogueProducts/sellingOptions.
function legacyProductView(product) {
  const options = Array.isArray(product.sellingOptions) ? product.sellingOptions : [];
  return {
    id: product.id,
    name: product.name || "",
    brand: product.brand || "",
    category: product.categoryId || "",
    desc: product.description || "",
    inStock: product.published === true && product.availability !== "unavailable",
    variants: options.map(option => ({
      id: option.id,
      color: option.label || "",
      processor: "",
      ram: "",
      rom: "",
      price: Number(option.priceMinor || 0) / 100,
      promoPrice: 0,
      image: (typeof product.images?.[0] === "string" ? product.images[0] : product.images?.[0]?.url) || "",
      inStock: option.enabled !== false
    })),
    upgrades: []
  };
}
function fromLegacyProduct(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return {
    name: product.name,
    brand: product.brand,
    categoryId: product.category,
    description: product.desc,
    published: product.inStock !== false,
    availability: variants.some(option => option.inStock !== false) ? "available" : "unavailable",
    images: variants.map(option => option.image).filter(Boolean).slice(0, 12),
    sellingOptions: variants.map((option, index) => ({
      id: option.id || randomHex(8),
      label: [option.color, option.processor, option.ram, option.rom].filter(Boolean).join(" / ") || `Option ${index + 1}`,
      sku: option.sku || "",
      priceMinor: Math.round(Number(option.promoPrice > 0 ? option.promoPrice : option.price || 0) * 100),
      enabled: option.inStock !== false
    }))
  };
}
export async function getProducts() {
  return (await listPublicCatalogue()).map(legacyProductView);
}
export function watchProducts(callback) {
  requireAdmin();
  return onSnapshot(query(collection(db, "catalogueProducts"), limit(500)), snapshot => {
    callback(snapshot.docs.map(item => legacyProductView({ id: item.id, ...item.data() })));
  }, error => console.error("Could not watch catalogue products:", error));
}
export async function addProduct(product) {
  const id = await saveCatalogueProduct(fromLegacyProduct(product));
  return { id };
}
export async function updateProduct(id, updates) {
  const existing = (await listAdminCatalogue()).find(item => item.id === id);
  if (!existing) throw new Error("Product not found.");
  const merged = { ...legacyProductView(existing), ...updates };
  await saveCatalogueProduct(fromLegacyProduct(merged), id);
  return { id };
}
export async function deleteProduct(id) {
  return deleteCatalogueProduct(id);
}
export async function placeOrder(order) {
  return submitGuestOrderRequest({
    ...order,
    fulfilmentMethod: "delivery"
  });
}

export function watchOrders(callback) {
  requireAdmin();
  return onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)), snapshot => {
    callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() })), { readOnlyFallback: false });
  }, error => console.error("Could not watch order requests:", error));
}
