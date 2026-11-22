import { initFirebase } from "../../js/firebase.mjs";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { app } = initFirebase();
const listInventorySetup = httpsCallable(getFunctions(app, "europe-west1"), "listInventorySetup");
const host = document.getElementById("structuredInventoryContent");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const panel = document.createElement("section");
panel.className = "rounded-2xl border bg-white p-4 space-y-3 mb-4";
panel.innerHTML = '<div class="flex items-center justify-between gap-2"><div><h2 class="font-black text-base">Inventory overview</h2><p class="text-xs text-gray-500">Private stock balances and selling-option coverage.</p></div><button id="inventoryOverviewRefresh" class="rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white">Refresh</button></div><div id="inventoryOverviewRows" class="space-y-4"><p class="text-xs text-gray-500">Loading stock records...</p></div>';
host?.prepend(panel);
document.addEventListener("tejuboss:structured-inventory-ready", () => host?.prepend(panel));
const rows = panel.querySelector("#inventoryOverviewRows");

async function refresh() {
  rows.textContent = "Loading stock records...";
  try {
    const response = await listInventorySetup({});
    const data = response.data;
    const forms = new Map((data.forms || []).map(form => [form.id, form]));
    const balances = Array.isArray(data.balances) ? data.balances : [];
    const mappings = Array.isArray(data.mappings) ? data.mappings : [];
    const balanceHtml = balances.length ? balances.map(balance => {
      const form = forms.get(balance.inventoryFormId) || {};
      return '<article class="rounded-xl border p-3 space-y-1"><div class="flex items-center justify-between gap-2"><strong class="text-sm">' +
        escape(balance.productId) + '</strong><span class="text-sm font-black">' +
        Number(balance.quantityOnHand).toLocaleString() + ' ' + escape(form.label || balance.inventoryFormId) +
        '</span></div><p class="text-[11px] text-gray-500">Variant: ' + escape(balance.variantId) +
        ' · Location: ' + escape(balance.locationId) + '</p><p class="text-[10px] text-gray-400 break-all">Form: ' +
        escape(balance.inventoryFormId) + ' · Balance ID: ' + escape(balance.id) + '</p></article>';
    }).join("") : '<p class="text-xs text-gray-500">No opening stock balances have been initialized yet.</p>';
    const mappingHtml = mappings.length ? mappings.map(mapping =>
      '<article class="rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-1"><div class="flex items-center justify-between gap-2"><strong class="text-xs">Selling option: ' +
      escape(mapping.sellingOptionId) + '</strong><span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-blue-800">Mapped</span></div>' +
      '<p class="text-[11px] text-gray-700">Product: ' + escape(mapping.productId) + ' · Variant: ' + escape(mapping.variantId) + '</p>' +
      '<p class="text-[11px] text-gray-600">Location: ' + escape(mapping.locationId) + ' · Form: ' + escape(mapping.inventoryFormId) + '</p>' +
      '<p class="text-[11px] text-gray-600">1 selling unit = ' + Number(mapping.stockUnitsPerSaleUnit).toLocaleString() + ' ' +
      escape(mapping.stockUnitCode) + ' · Balance unit = ' + Number(mapping.stockUnitsPerBalanceUnit).toLocaleString() + ' stock units</p>' +
      (mapping.sealedBalanceId ? '<p class="text-[11px] text-gray-600">Break-pack fallback: ' + escape(mapping.sealedInventoryFormId) + ' (' + Number(mapping.unitsPerPackage).toLocaleString() + ' per package)</p>' : '') +
      '<p class="text-[10px] text-gray-400 break-all">Mapping ID: ' + escape(mapping.id) + ' · Balance ID: ' + escape(mapping.balanceId) + '</p></article>'
    ).join("") : '<p class="text-xs text-gray-500">No selling-option inventory mappings have been saved yet. Map every active selling option before enabling checkout.</p>';
    rows.innerHTML = '<section class="space-y-2"><div class="flex items-center justify-between"><h3 class="text-sm font-black">Physical stock balances</h3><span class="text-xs text-gray-500">' + balances.length + ' records</span></div>' + balanceHtml + '</section>' +
      '<section class="space-y-2"><div class="flex items-center justify-between"><h3 class="text-sm font-black">Selling-option mappings</h3><span class="text-xs text-gray-500">' + mappings.length + ' mappings</span></div>' + mappingHtml + '</section>';
    if (data.truncated) rows.insertAdjacentHTML("beforeend", '<p class="text-xs text-amber-700">Showing a limited set of recent records.</p>');
  } catch (error) {
    rows.textContent = error.message || "Could not load inventory records.";
  }
}
panel.querySelector("#inventoryOverviewRefresh").addEventListener("click", refresh);
let started = false;
const stockTab = document.getElementById("stockSetupTabBtn");
stockTab?.addEventListener("click", () => { if (!started) { started = true; refresh(); } });
