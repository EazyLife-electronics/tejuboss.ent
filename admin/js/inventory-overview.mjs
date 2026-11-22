import { initFirebase } from "../../js/firebase.mjs";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { app } = initFirebase();
const listInventorySetup = httpsCallable(getFunctions(app, "europe-west1"), "listInventorySetup");
const host = document.getElementById("structuredInventoryContent");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const panel = document.createElement("section");
panel.className = "rounded-2xl border bg-white p-4 space-y-3 mb-4";
panel.innerHTML = '<div class="flex items-center justify-between gap-2"><div><h2 class="font-black text-base">Current stock balances</h2><p class="text-xs text-gray-500">Private inventory view for authorized staff.</p></div><button id="inventoryOverviewRefresh" class="rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white">Refresh</button></div><div id="inventoryOverviewRows" class="space-y-2"><p class="text-xs text-gray-500">Loading stock records...</p></div>';
host?.prepend(panel);
document.addEventListener("tejuboss:structured-inventory-ready", () => host?.prepend(panel));
const rows = panel.querySelector("#inventoryOverviewRows");
async function refresh() {
  rows.textContent = "Loading stock records...";
  try {
    const response = await listInventorySetup({});
    const data = response.data;
    const forms = new Map(data.forms.map(form => [form.id, form]));
    if (!data.balances.length) {
      rows.textContent = "No opening balances have been initialized yet.";
      return;
    }
    rows.innerHTML = data.balances.map(balance => {
      const form = forms.get(balance.inventoryFormId) || {};
      return '<article class="rounded-xl border p-3 space-y-1"><div class="flex items-center justify-between gap-2"><strong class="text-sm">' +
        escape(balance.productId) + '</strong><span class="text-sm font-black">' +
        Number(balance.quantityOnHand).toLocaleString() + ' ' + escape(form.label || balance.inventoryFormId) +
        '</span></div><p class="text-[11px] text-gray-500">Variant: ' + escape(balance.variantId) +
        ' · Location: ' + escape(balance.locationId) + '</p><p class="text-[10px] text-gray-400 break-all">Form: ' +
        escape(balance.inventoryFormId) + ' · Balance ID: ' + escape(balance.id) + '</p></article>';
    }).join("");
    if (data.truncated) rows.insertAdjacentHTML("beforeend", '<p class="text-xs text-amber-700">Showing a limited set of recent records.</p>');
  } catch (error) {
    rows.textContent = error.message || "Could not load inventory records.";
  }
}
panel.querySelector("#inventoryOverviewRefresh").addEventListener("click", refresh);
refresh();
