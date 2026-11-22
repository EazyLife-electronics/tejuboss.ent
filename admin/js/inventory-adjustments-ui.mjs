import { initFirebase } from "../../js/firebase.mjs";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { app } = initFirebase();
const functions = getFunctions(app, "europe-west1");
const listInventorySetup = httpsCallable(functions, "listInventorySetup");
const adjustCount = httpsCallable(functions, "adjustInventoryPhysicalCount");
const host = document.getElementById("structuredInventoryContent");
const panel = document.createElement("section");
panel.className = "rounded-2xl border bg-white p-4 space-y-3 mt-4";
panel.innerHTML = '<div><h2 class="font-black text-base">Correct a physical stock count</h2><p class="text-xs text-gray-500">Use only after recounting the selected stock form. The adjustment is audited and protected against stale quantities.</p></div><form id="physicalAdjustmentForm" class="space-y-3"><label class="block text-xs font-bold text-gray-600">Stock balance<select name="balanceId" required class="mt-1 w-full rounded-xl border bg-gray-50 p-3 text-sm"><option value="">Loading balances...</option></select></label><label class="block text-xs font-bold text-gray-600">New physically counted quantity<input name="countedQuantity" type="number" min="0" step="1" required class="mt-1 w-full rounded-xl border bg-gray-50 p-3 text-sm"></label><label class="block text-xs font-bold text-gray-600">Reason for adjustment<textarea name="reason" maxlength="240" required rows="2" placeholder="e.g. Weekly shelf and store-room recount" class="mt-1 w-full rounded-xl border bg-gray-50 p-3 text-sm"></textarea></label><label class="flex gap-2 text-xs text-gray-700"><input name="countConfirmed" type="checkbox" required> I have physically recounted this exact inventory form.</label><button class="w-full rounded-xl bg-red-600 p-3 text-sm font-bold text-white">Save audited count adjustment</button></form><p id="physicalAdjustmentStatus" class="hidden rounded-xl bg-gray-100 p-3 text-xs break-words"></p>';
host?.append(panel);
const form = panel.querySelector("form");
const select = form.elements.balanceId;
const status = panel.querySelector("#physicalAdjustmentStatus");
let balances = [];
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function load() {
  try {
    const response = await listInventorySetup({});
    balances = response.data.balances;
    select.innerHTML = '<option value="">Choose a stock balance</option>' + balances.map(b =>
      '<option value="' + escape(b.id) + '">' + escape(b.productId) + ' / ' + escape(b.variantId) +
      ' / ' + escape(b.inventoryFormId) + ' · on hand: ' + Number(b.quantityOnHand).toLocaleString() + '</option>'
    ).join("");
  } catch (error) {
    select.innerHTML = '<option value="">Could not load balances</option>';
    status.classList.remove("hidden");
    status.textContent = error.message || "Could not load stock records.";
  }
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  const balance = balances.find(item => item.id === select.value);
  if (!balance) return;
  const data = {
    balanceId: balance.id,
    expectedQuantityOnHand: balance.quantityOnHand,
    countedQuantity: Number(form.elements.countedQuantity.value),
    reason: form.elements.reason.value,
    countConfirmed: form.elements.countConfirmed.checked
  };
  status.classList.remove("hidden");
  status.textContent = "Saving audited physical count...";
  try {
    const result = await adjustCount(data);
    status.textContent = result.data.unchanged
      ? "Count matches the recorded quantity. No adjustment was needed."
      : "Count updated. Previous: " + balance.quantityOnHand + ", new: " + result.data.quantityOnHand + ", change: " + result.data.quantityDelta + ".";
    await load();
    form.reset();
  } catch (error) {
    status.textContent = error.message || "Count adjustment failed. Refresh the balance and recount if stock changed.";
  }
});
load();
