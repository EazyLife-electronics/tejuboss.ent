// admin/js/purchase-void.mjs
// Purchase reversals run through a trusted, App Check protected transaction.
import { initFirebase } from '../../js/firebase.mjs';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const { app, auth } = initFirebase();
const functions = getFunctions(app, "europe-west1");
const voidPurchaseCall = httpsCallable(functions, "voidLegacyPurchase");
let currentUser = null;
let observerStarted = false;
let busy = false;

function attachVoidButtons() {
  const rows = document.getElementById('purchaseRows');
  if (!rows || !currentUser) return;
  rows.querySelectorAll('[data-purchase-id]').forEach(row => {
    if (row.querySelector('.void-purchase-btn')) return;
    if ((row.dataset.purchaseStatus || 'received') !== 'received') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'void-purchase-btn mt-2 md:mt-0 border border-red-200 text-red-500 bg-red-50 px-3 py-2 rounded-lg font-bold text-[10px]';
    button.textContent = 'Void Purchase';
    button.addEventListener('click', () => voidPurchase(row.dataset.purchaseId, button));
    row.querySelector('.purchase-actions')?.appendChild(button);
  });
}
async function voidPurchase(purchaseId, button) {
  if (!currentUser || busy) return;
  if (!window.confirm('Void this purchase? Its received quantity will be removed from inventory. The purchase record will remain in history as VOIDED.')) return;
  const reason = window.prompt('Reason for voiding this purchase:', 'Purchase correction');
  if (reason === null) return;
  busy = true;
  button.disabled = true;
  button.textContent = 'Voiding...';
  try {
    const result = await voidPurchaseCall({ purchaseId, reason: reason.trim() });
    if (result.data?.outcome === 'already_voided') {
      button.textContent = 'Already voided';
    } else {
      button.textContent = 'Voided';
    }
    button.className = 'void-purchase-btn mt-2 md:mt-0 border border-gray-200 text-gray-400 bg-gray-100 px-3 py-2 rounded-lg font-bold text-[10px]';
    document.getElementById('purchaseHistoryRefresh')?.click();
  } catch (e) {
    button.disabled = false;
    button.textContent = 'Void Purchase';
    window.alert(e.message || 'Could not void purchase.');
  } finally {
    busy = false;
  }
}
function startObserver() {
  if (observerStarted) return;
  observerStarted = true;
  const observe = () => {
    const rows = document.getElementById('purchaseRows');
    if (!rows) return;
    new MutationObserver(attachVoidButtons).observe(rows, { childList: true, subtree: true });
    attachVoidButtons();
  };
  if (document.body) {
    const bodyObserver = new MutationObserver(observe);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    observe();
  }
}
onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) startObserver();
});
