// Clean Spark-compatible inventory console for catalogueProducts + inventoryBalances.
import { initFirebase } from "../../js/firebase.mjs";
import { collection, doc, getDocs, setDoc, updateDoc, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { recordInventoryMovement } from "../../js/commerce-store.mjs";
import { escapeHtml } from "./admin-shared.mjs";

const { db, auth } = initFirebase();
const LOCATION_ID = "main";
let products = [];
let balances = [];
let movements = [];

const money = value => "₦" + Number(value || 0).toLocaleString("en-NG");
const balanceKey = (productId, optionId) => [productId, optionId, LOCATION_ID].map(encodeURIComponent).join("__");
const optionLabel = option => option.label || option.id || "Option";

async function loadInventory() {
  if (auth.currentUser?.email?.toLowerCase() !== "damzyeazy@gmail.com") throw new Error("Administrator sign-in is required.");
  const [p, b, m] = await Promise.all([
    getDocs(query(collection(db, "catalogueProducts"), limit(500))),
    getDocs(query(collection(db, "inventoryBalances"), limit(1000))),
    getDocs(query(collection(db, "inventoryMovements"), orderBy("createdAt", "desc"), limit(30)))
  ]);
  products = p.docs.map(d => ({ id: d.id, ...d.data() }));
  balances = b.docs.map(d => ({ id: d.id, ...d.data() }));
  movements = m.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}

function render() {
  const root = document.getElementById("inventoryContent");
  if (!root) return;
  const rows = products.flatMap(product => (product.sellingOptions || []).map(option => {
    const id = balanceKey(product.id, option.id);
    const balance = balances.find(item => item.id === id);
    return { product, option, id, balance };
  }));
  const active = rows.filter(row => row.balance);
  const totalUnits = active.reduce((sum, row) => sum + Number(row.balance.quantityOnHand || 0), 0);
  const low = active.filter(row => Number(row.balance.quantityOnHand || 0) <= Number(row.balance.reorderLevel || 0)).length;
  root.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
      <div class="bg-white rounded-2xl border p-4"><p class="text-[10px] uppercase font-black text-gray-400">Tracked options</p><p class="text-2xl font-black">${active.length}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-[10px] uppercase font-black text-gray-400">Units on hand</p><p class="text-2xl font-black">${totalUnits.toLocaleString()}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-[10px] uppercase font-black text-gray-400">At / below reorder</p><p class="text-2xl font-black text-amber-600">${low}</p></div>
    </div>
    <section class="bg-white rounded-2xl border p-4 mb-4">
      <div class="flex flex-wrap justify-between gap-2 mb-3"><div><h2 class="font-black text-lg">Stock balances</h2><p class="text-xs text-gray-500">Initialize stock for a selling option, then record every increase or decrease as a movement.</p></div><button id="inventoryRefresh" class="px-3 py-2 rounded-lg bg-gray-100 text-xs font-bold">Refresh</button></div>
      <input id="inventorySearch" placeholder="Search product, option or SKU..." class="w-full p-3 mb-3 rounded-xl border bg-gray-50 text-sm">
      <div id="inventoryRows" class="space-y-2"></div>
    </section>
    <section class="bg-white rounded-2xl border p-4"><h2 class="font-black text-lg mb-1">Recent stock movements</h2><div id="movementRows" class="space-y-2 mt-3"></div></section>`;
  const draw = () => {
    const term = document.getElementById("inventorySearch").value.toLowerCase();
    const visible = rows.filter(row => `${row.product.name} ${optionLabel(row.option)} ${row.balance?.sku || ""}`.toLowerCase().includes(term));
    document.getElementById("inventoryRows").innerHTML = visible.map(row => {
      const quantity = row.balance ? Number(row.balance.quantityOnHand || 0) : null;
      const status = !row.balance ? "NOT INITIALIZED" : quantity <= Number(row.balance.reorderLevel || 0) ? "LOW" : "OK";
      return `<article class="border rounded-xl p-3">
        <div class="flex flex-wrap justify-between gap-2"><div><p class="font-bold text-sm">${escapeHtml(row.product.name)}</p><p class="text-xs text-gray-500">${escapeHtml(optionLabel(row.option))}</p></div><span class="text-[10px] font-black rounded-full px-2 py-1 ${status === "LOW" ? "bg-amber-100 text-amber-700" : status === "OK" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}">${status}</span></div>
        ${row.balance ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <div class="rounded-lg bg-gray-50 p-2"><p class="text-[9px] uppercase text-gray-400 font-bold">On hand</p><p class="font-black text-lg">${quantity}</p></div>
          <label class="text-[10px] font-bold text-gray-500">SKU<input data-sku="${escapeHtml(row.id)}" value="${escapeHtml(row.balance.sku || "")}" class="mt-1 w-full border rounded-lg p-2 text-xs"></label>
          <label class="text-[10px] font-bold text-gray-500">Reorder level<input data-reorder="${escapeHtml(row.id)}" type="number" min="0" step="1" value="${Number(row.balance.reorderLevel || 0)}" class="mt-1 w-full border rounded-lg p-2 text-xs"></label>
          <div class="flex items-end"><button data-save-balance="${escapeHtml(row.id)}" class="w-full bg-gray-900 text-white rounded-lg p-2 text-xs font-bold">Save details</button></div>
        </div><div class="grid grid-cols-2 gap-2 mt-2"><button data-movement="${escapeHtml(row.id)}" data-delta="1" class="bg-green-50 text-green-700 rounded-lg py-2 text-xs font-bold">+ Receive / Add</button><button data-movement="${escapeHtml(row.id)}" data-delta="-1" class="bg-red-50 text-red-700 rounded-lg py-2 text-xs font-bold">− Issue / Remove</button></div>` : `
          <div class="grid grid-cols-2 gap-2 mt-3"><input data-opening="${escapeHtml(row.id)}" type="number" min="0" step="1" value="0" class="border rounded-lg p-2 text-xs" aria-label="Opening quantity"><button data-initialize="${escapeHtml(row.id)}" class="bg-gray-900 text-white rounded-lg py-2 text-xs font-bold">Initialize balance</button></div>`}
      </article>`;
    }).join("") || '<p class="text-xs text-gray-400 py-5 text-center">No matching catalogue options.</p>';
    document.querySelectorAll("[data-initialize]").forEach(button => button.onclick = () => initialize(button.dataset.initialize));
    document.querySelectorAll("[data-movement]").forEach(button => button.onclick = () => move(button.dataset.movement, Number(button.dataset.delta)));
    document.querySelectorAll("[data-save-balance]").forEach(button => button.onclick = () => saveDetails(button.dataset.saveBalance));
  };
  draw();
  document.getElementById("inventorySearch").addEventListener("input", draw);
  document.getElementById("inventoryRefresh").onclick = () => loadInventory().catch(showError);
  document.getElementById("movementRows").innerHTML = movements.map(item => `<div class="flex flex-wrap justify-between gap-2 border-b last:border-0 py-2 text-xs"><span>${escapeHtml(item.movementType || "adjustment")} · ${escapeHtml(item.reason || "No reason")} <span class="text-gray-400">${escapeHtml(item.productId || "")}</span></span><b class="${Number(item.quantityDelta) > 0 ? "text-green-700" : "text-red-700"}">${Number(item.quantityDelta) > 0 ? "+" : ""}${Number(item.quantityDelta)}</b></div>`).join("") || '<p class="text-xs text-gray-400">No stock movements recorded yet.</p>';
}

async function initialize(id) {
  const row = findRow(id);
  if (!row) return;
  const quantity = Number(document.querySelector(`[data-opening="${CSS.escape(id)}"]`)?.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return alert("Enter a valid opening quantity.");
  if (!confirm("Create an inventory balance with this opening quantity?")) return;
  try {
    await setDoc(doc(db, "inventoryBalances", id), {
      productId: row.product.id, sellingOptionId: row.option.id, locationId: LOCATION_ID,
      quantityOnHand: 0, reorderLevel: 0, sku: "", createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid
    });
    if (quantity > 0) await recordInventoryMovement({ balanceId: id, quantityDelta: quantity, movementType: "opening_balance", reason: "Initial stock setup" });
    await loadInventory();
  } catch (error) { showError(error); }
}
async function move(id, direction) {
  const raw = prompt(direction > 0 ? "Quantity received:" : "Quantity issued:");
  if (raw === null) return;
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return alert("Enter a positive whole number.");
  const reason = prompt("Reason / reference for this stock movement:");
  if (!reason?.trim()) return alert("A reason is required.");
  try {
    await recordInventoryMovement({ balanceId: id, quantityDelta: quantity * direction, movementType: direction > 0 ? "receipt" : "issue", reason });
    await loadInventory();
  } catch (error) { showError(error); }
}
async function saveDetails(id) {
  const sku = document.querySelector(`[data-sku="${CSS.escape(id)}"]`)?.value.trim() || "";
  const reorderLevel = Number(document.querySelector(`[data-reorder="${CSS.escape(id)}"]`)?.value);
  if (!Number.isSafeInteger(reorderLevel) || reorderLevel < 0) return alert("Reorder level must be a non-negative whole number.");
  try {
    await updateDoc(doc(db, "inventoryBalances", id), { sku, reorderLevel, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
    await loadInventory();
  } catch (error) { showError(error); }
}
function findRow(id) {
  for (const product of products) for (const option of product.sellingOptions || []) if (balanceKey(product.id, option.id) === id) return { product, option };
  return null;
}
function showError(error) { console.error(error); alert("Inventory action failed: " + (error?.message || error)); }
export function initInventory() {
  loadInventory().catch(showError);
  return () => {};
}
