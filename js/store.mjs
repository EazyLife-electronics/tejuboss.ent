// js/store.mjs
// Firestore data layer shared by shop.html and the admin dashboard.
// Inventory-aware order status changes are performed transactionally.

import { initFirebase } from './firebase.mjs';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const { db, app } = initFirebase();
const contentFunctions = getFunctions(app, 'europe-west1');
const manageContentCallable = httpsCallable(contentFunctions, 'manageLegacyPublicContent');
async function contentCall(collectionName, action, values = undefined, id = undefined, extra = {}) {
  const response = await manageContentCallable({ collection: collectionName, action, ...(values === undefined ? {} : { values }), ...(id === undefined ? {} : { id }), ...extra });
  return response.data;
}
const contentWatchers = { heroes: new Set(), reviews: new Set(), requests: new Set() };
async function refreshContent(collectionName, publicOnly = false) {
  const rows = await contentCall(collectionName, 'list', undefined, undefined, publicOnly ? { publicOnly: true } : {});
  for (const callback of contentWatchers[collectionName] || []) callback(rows);
  return rows;
}
function watchContent(collectionName, callback) {
  const callbacks = contentWatchers[collectionName]; callbacks.add(callback);
  refreshContent(collectionName, false).catch(error => console.error(`Could not load ${collectionName}:`, error));
  return () => callbacks.delete(callback);
}

/* ---------------- ADMIN ERROR FEEDBACK ---------------- */
// Many Admin buttons intentionally use fire-and-forget async handlers. If an async
// action rejects without a local catch, the browser otherwise only shows a console
// error, making the button look like it did nothing. Surface the real error to the
// logged-in Admin while keeping the underlying rejection visible in the console.
if (typeof window !== 'undefined' &&
    (location.pathname.endsWith('/admin/') || location.pathname.endsWith('/admin/index.html'))) {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason || 'Unknown error');
    console.error('Admin action failed:', reason);

    if (typeof window.alert === 'function') {
      window.alert(`Action failed: ${message}`);
    }

    event.preventDefault();
  });
}

/* ---------------- PRODUCTS ---------------- */

const manageProductsCallable = httpsCallable(contentFunctions, 'manageLegacyProducts');
async function productCall(action, product = undefined, id = undefined) {
  const response = await manageProductsCallable({ action, ...(product === undefined ? {} : { product }), ...(id === undefined ? {} : { id }) });
  return response.data;
}
// The free-tier storefront must remain usable when the optional callable
// catalogue endpoint is not deployed. Firestore already permits public product
// reads; project the same explicitly public fields as publicProduct() in the
// callable and never pass the raw document to the storefront.
function publicProductProjection(id, data = {}) {
  return {
    id,
    name: data.name || '',
    brand: data.brand || '',
    category: data.category || '',
    desc: data.desc || '',
    inStock: data.inStock !== false,
    variants: (Array.isArray(data.variants) ? data.variants : []).map(v => ({
      id: v.id, color: v.color || '', processor: v.processor || '',
      ram: v.ram || '', rom: v.rom || '', price: v.price || 0,
      promoPrice: v.promoPrice || 0, image: v.image || '',
      deliveryFee: v.deliveryFee ?? null, deliveryRoute: v.deliveryRoute || 'general',
      bulkSavingsEnabled: !!v.bulkSavingsEnabled,
      bulkSavingsMode: v.bulkSavingsMode || 'general',
      bulkSavingsPercent: v.bulkSavingsPercent || 0,
      bulkSavingsMinQty: v.bulkSavingsMinQty || 0, inStock: v.inStock !== false
    })),
    upgrades: Array.isArray(data.upgrades)
      ? data.upgrades.map(u => ({ id: u.id || '', name: u.name || '', price: u.price || 0 }))
      : []
  };
}
function isCallableUnavailable(error) {
  return ['functions/internal', 'functions/unavailable', 'functions/not-found',
    'functions/failed-precondition'].includes(error?.code);
}
export async function getProducts() {
  try {
    return await productCall('publicList');
  } catch (error) {
    if (!isCallableUnavailable(error)) throw error;
    console.warn('Catalogue callable is unavailable; using the safe public Firestore projection.', error);
    const snapshot = await getDocs(query(collection(db, 'products')));
    return snapshot.docs.map(docSnap => publicProductProjection(docSnap.id, docSnap.data()))
      .filter(product => product.inStock && product.variants.some(variant => variant.inStock !== false));
  }
}
const productWatchers = new Set();
async function refreshProducts() {
  const rows = await productCall('list');
  for (const callback of productWatchers) callback(rows);
  return rows;
}
export function watchProducts(callback) {
  productWatchers.add(callback);
  refreshProducts().catch(error => console.error('Could not load admin products:', error));
  return () => productWatchers.delete(callback);
}
export async function addProduct(product) {
  const result = await productCall('create', product);
  await refreshProducts();
  return result;
}
export async function updateProduct(id, updates) {
  const result = await productCall('update', updates, id);
  await refreshProducts();
  return result;
}
export async function deleteProduct(id) {
  const result = await productCall('delete', undefined, id);
  await refreshProducts();
  return result;
}

/* ---------------- ORDERS ---------------- */

function generateTrackingCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = 'TB-';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function variantLabelForOrder(v, index) {
  const bits = [v?.processor, v?.ram, v?.rom, v?.color].filter(Boolean);
  return bits.length ? bits.join(' / ') : `Variant ${index + 1}`;
}

async function resolveOrderItems(items) {
  const productsSnap = await getDocs(collection(db, 'products'));
  const products = new Map(productsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  return (items || []).map(item => {
    if (!item?.productId || item.variantId) return item;

    const product = products.get(item.productId);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const wanted = String(item.variant || '').trim().toLowerCase();
    const matches = variants.map((v, index) => ({ v, index }))
      .filter(({ v, index }) => variantLabelForOrder(v, index).trim().toLowerCase() === wanted);

    if (matches.length !== 1) {
      throw new Error(`This order item could not be matched to a unique product variant: ${item.name || item.productId} (${item.variant || 'variant not specified'}). Please refresh the catalog and try again.`);
    }

    const { v } = matches[0];
    if (!v.id) {
      throw new Error(`The selected variant for ${item.name || item.productId} has no variant ID. Please edit and save that product before ordering.`);
    }

    return { ...item, variantId: v.id, sku: v.sku || '' };
  });
}

export async function placeOrder(order) {
  const trackingCode = generateTrackingCode();
  const items = await resolveOrderItems(order.items || []);
  await setDoc(doc(db, 'orders', trackingCode), {
    customerName: String(order.customerName || '').trim(),
    phone: String(order.phone || '').trim(),
    address: String(order.address || '').trim(),
    items,
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.deliveryFee),
    total: Number(order.total),
    trackingCode,
    status: 'new',
    inventoryApplied: false,
    inventoryReturned: false,
    createdAt: serverTimestamp()
  });
  return trackingCode;
}

const legacyTrackingCallable = httpsCallable(contentFunctions, 'getLegacyOrderTracking');
export async function getOrderByTrackingCode(code, phoneLast4) {
  if (typeof phoneLast4 !== 'string' || !/^\d{4}$/.test(phoneLast4)) {
    throw new Error('The last four digits of the order phone number are required for tracking.');
  }
  const response = await legacyTrackingCallable({ trackingCode: code, phoneLast4 });
  return response.data?.tracking || null;
}
// Links an order to the delivery record created for it, so the public
// tracking page can fetch that one delivery directly by ID (a plain `get`,
// same trust model as order lookup) instead of needing broader read access
// to the deliveries collection.
const linkDeliveryCallable = httpsCallable(contentFunctions, 'linkLegacyOrderDelivery');
export async function linkOrderToDelivery(orderId, deliveryId) {
  const response = await linkDeliveryCallable({ orderId, deliveryId });
  return response.data;
}

const listLegacyOrdersCallable = httpsCallable(contentFunctions, 'listLegacyOrders');
const orderWatchers = new Set();
async function refreshOrders() {
  try {
    const response = await listLegacyOrdersCallable({ limit: 100 });
    const rows = response.data.orders || [];
    for (const callback of orderWatchers) callback(rows, { readOnlyFallback: false });
    return rows;
  } catch (error) {
    if (!isCallableUnavailable(error)) throw error;
    // Firestore rules restrict order listing to the configured administrator.
    // This fallback is deliberately read-only: lifecycle and stock changes
    // must continue through the trusted callable, never browser-side writes.
    console.warn('Order-list callable unavailable; loading the admin-only read-only queue.', error);
    const snapshot = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(100)));
    const rows = snapshot.docs.map(orderDoc => ({ id: orderDoc.id, ...orderDoc.data() }));
    for (const callback of orderWatchers) callback(rows, { readOnlyFallback: true });
    return rows;
  }
}
export function watchOrders(callback) {
  orderWatchers.add(callback);
  refreshOrders().catch(error => console.error('Could not load orders:', error));
  return () => orderWatchers.delete(callback);
}

const legacyOrderCallable = httpsCallable(contentFunctions, 'manageLegacyOrderLifecycle');
export async function updateOrderStatus(id, status) {
  const response = await legacyOrderCallable({ action: 'status', orderId: id, status });
  const result = response.data;
  await refreshOrders();
  return result;
}
export async function cancelOrder(id, { reason = null, customerNote = null, internalNote = null } = {}) {
  const response = await legacyOrderCallable({ action: 'cancel', orderId: id, reason, customerNote, internalNote });
  const result = response.data;
  await refreshOrders();
  return result;
}

/* ---------------- LEGACY CONTENT VIA TRUSTED FUNCTIONS ---------------- */

export async function getHeroes() {
  return contentCall('heroes', 'list', undefined, undefined, { publicOnly: true });
}
export function watchHeroes(callback) { return watchContent('heroes', callback); }
export async function addHero(hero) { const result = await contentCall('heroes', 'create', hero); await refreshContent('heroes'); return result; }
export async function updateHero(id, updates) { const result = await contentCall('heroes', 'update', updates, id); await refreshContent('heroes'); return result; }
export async function deleteHero(id) { const result = await contentCall('heroes', 'delete', undefined, id); await refreshContent('heroes'); return result; }

export async function getApprovedReviews() {
  return contentCall('reviews', 'list', undefined, undefined, { publicOnly: true });
}
export function watchReviews(callback) { return watchContent('reviews', callback); }
export async function addReview(review) { const result = await contentCall('reviews', 'create', review); await refreshContent('reviews'); return result; }
export async function updateReview(id, updates) { const result = await contentCall('reviews', 'update', updates, id); await refreshContent('reviews'); return result; }
export async function deleteReview(id) { const result = await contentCall('reviews', 'delete', undefined, id); await refreshContent('reviews'); return result; }

export async function placeRequest(request) {
  return contentCall('requests', 'create', { name: request.name, phone: request.phone, need: request.need, category: request.category || '', budget: request.budget ?? '' });
}
export function watchRequests(callback) { return watchContent('requests', callback); }
export async function updateRequestStatus(id, status) { const result = await contentCall('requests', 'update', { status }, id); await refreshContent('requests'); return result; }

// Only these fields are intended for storefront use. Keep the projection in
// sync with PUBLIC_SETTINGS in functions/src/legacy-public-content-admin.mjs.
const PUBLIC_SETTING_FIELDS = [
  'whatsapp', 'tagline', 'aboutText', 'deliveryFeePerItem',
  'deliveryDiscountPercent', 'minOrderValue', 'bulkSavingsPercent',
  'bulkSavingsMinQty'
];
async function readPublicSettingsFromFirestore() {
  const snapshot = await getDoc(doc(db, 'settings', 'site'));
  if (!snapshot.exists()) return {};
  const source = snapshot.data();
  return Object.fromEntries(PUBLIC_SETTING_FIELDS
    .filter(field => Object.prototype.hasOwnProperty.call(source, field))
    .map(field => [field, source[field]]));
}
export async function getSettings() {
  try {
    return await contentCall('settings', 'getPublic');
  } catch (error) {
    if (!isCallableUnavailable(error)) throw error;
    console.warn('Public settings callable is unavailable; using the safe public settings projection.', error);
    return readPublicSettingsFromFirestore();
  }
}
export async function getPublicSettings() {
  return getSettings();
}
export async function saveSettings(settings) {
  return contentCall('settings', 'save', settings);
}

/* ---------------- INVENTORY ADMIN TAB ---------------- */
if (location.pathname.endsWith('/admin/') || location.pathname.endsWith('/admin/index.html')) {
  const setupInventoryTab = async () => {
    const tabs = document.querySelector('.tab-btn')?.parentElement;
    if (!tabs || document.getElementById('inventoryTabBtn')) return;
    const button = document.createElement('button');
    button.id = 'inventoryTabBtn';
    button.dataset.tab = 'inventory';
    button.className = 'tab-btn px-5 py-2 rounded-full text-xs font-bold bg-gray-100';
    button.textContent = 'Inventory';
    tabs.insertBefore(button, tabs.children[1] || null);
    const panel = document.createElement('div');
    panel.id = 'panel-inventory';
    panel.className = 'tab-panel hidden';
    panel.innerHTML = '<div id="inventoryContent"></div>';
    const anchor = document.getElementById('panel-heroes');
    if (anchor) anchor.parentElement.insertBefore(panel, anchor);
    const { initInventory } = await import('../admin/js/inventory.mjs');
    let stop = null;
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      button.classList.add('tab-active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      panel.classList.remove('hidden');
      if (!stop) stop = initInventory();
    });
    document.querySelectorAll('.tab-btn:not(#inventoryTabBtn)').forEach(other => other.addEventListener('click', () => {
      if (stop) { stop(); stop = null; }
    }));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupInventoryTab, { once: true });
  else setupInventoryTab();
}