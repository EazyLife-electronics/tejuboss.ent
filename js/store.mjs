// js/store.mjs
// Firestore data layer shared by shop.html and the admin dashboard.
// Inventory-aware order status changes are performed transactionally.

import { initFirebase } from './firebase.mjs';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, runTransaction
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
export async function getProducts() {
  return productCall('publicList');
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
    ...order,
    items,
    trackingCode,
    status: 'new',
    inventoryApplied: false,
    inventoryReturned: false,
    createdAt: serverTimestamp()
  });
  return trackingCode;
}

export async function getOrderByTrackingCode(code) {
  const snap = await getDoc(doc(db, 'orders', code.trim().toUpperCase()));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Links an order to the delivery record created for it, so the public
// tracking page can fetch that one delivery directly by ID (a plain `get`,
// same trust model as order lookup) instead of needing broader read access
// to the deliveries collection.
export async function linkOrderToDelivery(orderId, deliveryId) {
  await updateDoc(doc(db, 'orders', orderId), { deliveryId });
}

// Public read: anyone with an order's tracking code can already see that
// order's full details (see the `orders` Firestore rule), so exposing the
// one delivery record it links to is the same trust boundary, not a new one.
export async function getDelivery(deliveryId) {
  if (!deliveryId) return null;
  const snap = await getDoc(doc(db, 'deliveries', deliveryId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchOrders(callback) {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

const legacyOrderCallable = httpsCallable(contentFunctions, 'manageLegacyOrderLifecycle');
export async function updateOrderStatus(id, status) {
  const response = await legacyOrderCallable({ action: 'status', orderId: id, status });
  return response.data;
}
export async function cancelOrder(id, { reason = null, customerNote = null, internalNote = null } = {}) {
  const response = await legacyOrderCallable({ action: 'cancel', orderId: id, reason, customerNote, internalNote });
  return response.data;
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

export async function getSettings() {
  return contentCall('settings', 'getPublic');
}
export async function getPublicSettings() {
  return contentCall('settings', 'getPublic');
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