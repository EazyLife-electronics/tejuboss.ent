import { validateCatalogueDraft, nairaToKobo, createCatalogueId } from "../../functions/src/domain/catalogue-draft.mjs";
import { escapeHtml } from "./admin-shared.mjs";

const STORAGE_KEY = "tejuboss.catalogueDrafts.v1";
const root = document.getElementById("catalogueBuilderContent");
let drafts = loadDrafts();
let editingId = null;

function loadDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  renderList();
}
function moneyInput(minor) {
  return minor == null ? "" : (minor / 100).toFixed(2).replace(/\.00$/, "");
}
function blankOption() {
  return { id: createCatalogueId("option"), unitCode: "piece", displayName: "Piece", stockUnitsPerSaleUnit: 1, minimumOrderQuantity: 1, orderQuantityStep: 1, active: true, priceMinor: 0 };
}
function blankVariant() {
  return { id: createCatalogueId("variant"), active: true, stockUnit: { code: "piece", label: "Piece" }, quantityPrecision: 0, sellingOptions: [blankOption()] };
}
function blankDraft() {
  return { id: createCatalogueId("product"), name: "", brand: "", category: "", description: "", published: false, variants: [blankVariant()] };
}
function optionCard(option, vi, oi) {
  return `<div class="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2" data-option data-vi="${vi}" data-oi="${oi}">
    <div class="flex items-center justify-between"><b class="text-xs">Selling option ${oi + 1}</b><button type="button" data-remove-option class="text-xs text-red-600 font-bold">Remove</button></div>
    <div class="grid grid-cols-2 gap-2">
      <label class="text-[11px] text-gray-500">Unit code<input data-field="unitCode" value="${escapeHtml(option.unitCode)}" placeholder="piece, pack, carton" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Customer label<input data-field="displayName" value="${escapeHtml(option.displayName)}" placeholder="Carton of 48" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Stock units per option<input data-field="stockUnitsPerSaleUnit" type="number" min="1" step="1" value="${option.stockUnitsPerSaleUnit}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Price (₦)<input data-field="priceNaira" type="number" min="0" step="0.01" value="${moneyInput(option.priceMinor)}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Promo price (₦)<input data-field="promoNaira" type="number" min="0" step="0.01" value="${option.promoPriceMinor == null ? "" : moneyInput(option.promoPriceMinor)}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Minimum quantity<input data-field="minimumOrderQuantity" type="number" min="0.000001" step="any" value="${option.minimumOrderQuantity}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Order quantity step<input data-field="orderQuantityStep" type="number" min="0.000001" step="any" value="${option.orderQuantityStep}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
    </div>
    <label class="flex items-center gap-2 text-xs text-gray-600"><input data-field="active" type="checkbox" ${option.active ? "checked" : ""}> Available for sale</label>
    <p class="text-[10px] text-gray-400">Conversion is explicit. Example: one carton = 48 stock pieces. Do not guess this value.</p>
  </div>`;
}
function variantCard(variant, vi) {
  return `<section class="rounded-2xl border border-gray-200 p-3 space-y-3" data-variant data-vi="${vi}">
    <div class="flex items-center justify-between"><h4 class="font-bold text-sm">Variant ${vi + 1}</h4><button type="button" data-remove-variant class="text-xs text-red-600 font-bold">Remove variant</button></div>
    <div class="grid grid-cols-2 gap-2">
      <label class="text-[11px] text-gray-500">Stock unit code<input data-vfield="stockCode" value="${escapeHtml(variant.stockUnit.code)}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Stock unit label<input data-vfield="stockLabel" value="${escapeHtml(variant.stockUnit.label)}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
      <label class="text-[11px] text-gray-500">Quantity precision (0-6)<input data-vfield="quantityPrecision" type="number" min="0" max="6" step="1" value="${variant.quantityPrecision}" class="mt-1 w-full p-2 rounded-lg border text-sm"></label>
    </div>
    <div class="space-y-2" data-options>${variant.sellingOptions.map((o,oi)=>optionCard(o,vi,oi)).join("")}</div>
    <button type="button" data-add-option class="w-full py-2 rounded-lg bg-gray-100 text-xs font-bold">+ Add selling option</button>
  </section>`;
}
function editorHtml(draft) {
 return `<form id="catalogueDraftForm" class="bg-white rounded-2xl shadow-sm p-4 space-y-4">
  <div class="flex items-center justify-between"><div><h2 class="font-black text-lg">${editingId ? "Edit catalogue draft" : "New catalogue product"}</h2><p class="text-xs text-gray-500">Structured catalogue, independent of the existing legacy product form.</p></div><span class="text-[10px] rounded-full bg-amber-50 text-amber-700 px-2 py-1 font-bold">DRAFT</span></div>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label class="text-xs font-bold text-gray-600">Product name<input name="name" required value="${escapeHtml(draft.name)}" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"></label>
    <label class="text-xs font-bold text-gray-600">Category<input name="category" required value="${escapeHtml(draft.category)}" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"></label>
    <label class="text-xs font-bold text-gray-600">Brand<input name="brand" value="${escapeHtml(draft.brand)}" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"></label>
    <label class="text-xs font-bold text-gray-600">Publication<select name="published" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"><option value="false" ${!draft.published ? "selected" : ""}>Unpublished draft</option><option value="true" ${draft.published ? "selected" : ""}>Published (not activated on storefront)</option></select></label>
  </div>
  <label class="block text-xs font-bold text-gray-600">Description<textarea name="description" rows="2" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">${escapeHtml(draft.description)}</textarea></label>
  <div class="space-y-3"><div class="flex items-center justify-between"><h3 class="font-black text-sm">Variants and selling options</h3><button type="button" id="addCatalogueVariant" class="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold">+ Add variant</button></div><div id="catalogueVariants" class="space-y-3">${draft.variants.map(variantCard).join("")}</div></div>
  <div id="catalogueValidation" class="hidden rounded-xl bg-red-50 text-red-700 p-3 text-xs"></div>
  <div class="flex gap-2"><button type="submit" class="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold text-sm">Save draft</button><button type="button" id="cancelCatalogueEdit" class="px-4 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm">Cancel</button></div>
 </form>`;
}
function readDraftFromForm(form) {
 const old = drafts.find(d => d.id === editingId);
 const draft = { id: old?.id || createCatalogueId("product"), name: form.elements.name.value.trim(), category: form.elements.category.value.trim(), brand: form.elements.brand.value.trim(), description: form.elements.description.value.trim(), published: form.elements.published.value === "true", variants: [] };
 document.querySelectorAll("#catalogueVariants [data-variant]").forEach((card,vi) => {
  const previous = old?.variants?.[vi];
  const variant = { id: previous?.id || createCatalogueId("variant"), active: true, stockUnit: { code: card.querySelector('[data-vfield="stockCode"]').value.trim(), label: card.querySelector('[data-vfield="stockLabel"]').value.trim() }, quantityPrecision: Number(card.querySelector('[data-vfield="quantityPrecision"]').value), sellingOptions: [] };
  card.querySelectorAll("[data-option]").forEach((node,oi) => {
   const prev = previous?.sellingOptions?.[oi];
   const get = key => node.querySelector(`[data-field="${key}"]`);
   const promo = get("promoNaira").value.trim();
   variant.sellingOptions.push({ id: prev?.id || createCatalogueId("option"), unitCode: get("unitCode").value.trim(), displayName: get("displayName").value.trim(), stockUnitsPerSaleUnit: Number(get("stockUnitsPerSaleUnit").value), minimumOrderQuantity: Number(get("minimumOrderQuantity").value), orderQuantityStep: Number(get("orderQuantityStep").value), active: get("active").checked, priceMinor: nairaToKobo(get("priceNaira").value, "Price"), ...(promo === "" ? {} : { promoPriceMinor: nairaToKobo(promo, "Promo price") }) });
  });
  draft.variants.push(variant);
 });
 return draft;
}
function renderList() {
 const list = document.getElementById("catalogueDraftList");
 if (!list) return;
 list.innerHTML = drafts.map(d => `<article class="bg-white rounded-xl border p-3 flex items-center gap-3"><div class="min-w-0 flex-1"><b class="block text-sm truncate">${escapeHtml(d.name || "Untitled product")}</b><p class="text-[10px] text-gray-500">${d.variants.length} variant(s) · ${d.published ? "Marked published" : "Unpublished"} · Local draft</p><p class="text-[9px] font-mono text-gray-400 break-all">${escapeHtml(d.id)}</p></div><button data-edit-draft="${escapeHtml(d.id)}" class="text-xs font-bold bg-gray-100 rounded-lg px-3 py-2">Edit</button><button data-delete-draft="${escapeHtml(d.id)}" class="text-xs font-bold text-red-600 px-2 py-2">Delete</button></article>`).join("") || '<p class="text-xs text-gray-400 py-4">No structured drafts saved on this device yet.</p>';
 list.querySelectorAll("[data-edit-draft]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.editDraft)));
 list.querySelectorAll("[data-delete-draft]").forEach(b=>b.addEventListener("click",()=>{if(confirm("Delete this local draft?")){drafts=drafts.filter(d=>d.id!==b.dataset.deleteDraft);persist();}}));
}
function openEditor(id=null) {
 editingId=id;
 const draft=id ? drafts.find(d=>d.id===id) : blankDraft();
 root.querySelector("#catalogueEditorHost").innerHTML=editorHtml(draft);
 const form=document.getElementById("catalogueDraftForm");
 form.addEventListener("submit",e=>{
  e.preventDefault();
  const box=document.getElementById("catalogueValidation");
  try {
   const value=readDraftFromForm(form);
   const result=validateCatalogueDraft(value);
   if(!result.valid){box.innerHTML=result.issues.map(i=>`<p>• ${escapeHtml(i.path)}: ${escapeHtml(i.message)}</p>`).join("");box.classList.remove("hidden");return;}
   const index=drafts.findIndex(d=>d.id===value.id);
   if(index>=0)drafts[index]=value;else drafts.unshift(value);
   persist();editingId=null;root.querySelector("#catalogueEditorHost").innerHTML="";root.querySelector("#catalogueEditorHost").scrollIntoView({behavior:"smooth"});
  } catch(err){box.textContent=err.message;box.classList.remove("hidden");}
 });
 document.getElementById("cancelCatalogueEdit").addEventListener("click",()=>{editingId=null;root.querySelector("#catalogueEditorHost").innerHTML="";});
 document.getElementById("addCatalogueVariant").addEventListener("click",()=>{const wrap=document.getElementById("catalogueVariants");wrap.insertAdjacentHTML("beforeend",variantCard(blankVariant(),wrap.children.length));});
 document.getElementById("catalogueVariants").addEventListener("click",e=>{
  const variant=e.target.closest("[data-variant]");
  if(e.target.closest("[data-remove-variant]")){if(document.querySelectorAll("#catalogueVariants [data-variant]").length>1)variant.remove();else alert("A product needs at least one variant.");}
  if(e.target.closest("[data-add-option]")){const options=variant.querySelector("[data-options]");options.insertAdjacentHTML("beforeend",optionCard(blankOption(),variant.dataset.vi,options.children.length));}
  if(e.target.closest("[data-remove-option]")){const options=variant.querySelector("[data-options]");if(options.children.length>1)e.target.closest("[data-option]").remove();else alert("A variant needs at least one selling option.");}
 });
}
function downloadJson() {
 const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),drafts},null,2)],{type:"application/json"});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="tejuboss-catalogue-drafts.json";a.click();URL.revokeObjectURL(url);
}
function importJson(file) {
 const reader=new FileReader();reader.onload=()=>{
  try{const data=JSON.parse(reader.result);if(data.schemaVersion!==1||!Array.isArray(data.drafts))throw new Error("This is not a supported Tejuboss catalogue export.");
   const valid=data.drafts.filter(d=>validateCatalogueDraft(d).valid);
   if(valid.length!==data.drafts.length)throw new Error("Some imported drafts failed validation. Nothing was imported.");
   const map=new Map(drafts.map(d=>[d.id,d]));valid.forEach(d=>map.set(d.id,d));drafts=[...map.values()];persist();alert(`Imported ${valid.length} draft(s).`);
  }catch(err){alert(err.message);}
 };reader.readAsText(file);
}
function render() {
 root.innerHTML=`<div class="space-y-4">
  <div class="bg-blue-50 border border-blue-100 rounded-2xl p-4"><h2 class="font-black text-base mb-1">Structured Catalogue Builder</h2><p class="text-xs text-blue-900">Build products with explicit selling units and stock conversions. Drafts currently stay in this browser on this device. Use Export/Import to move them between your phone and computer.</p><p class="text-[10px] text-blue-800 mt-2 font-bold">Important: Saving here does not publish a product, change inventory, or write to Firestore.</p></div>
  <div class="flex gap-2"><button id="newCatalogueDraft" class="flex-1 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold">+ New product draft</button><button id="exportCatalogueDrafts" class="px-4 py-3 bg-white border rounded-xl text-xs font-bold">Export</button><label class="px-4 py-3 bg-white border rounded-xl text-xs font-bold cursor-pointer">Import<input id="importCatalogueDrafts" type="file" accept=".json,application/json" class="hidden"></label></div>
  <div id="catalogueEditorHost"></div><div><h3 class="font-black text-sm mb-2">Saved drafts on this device</h3><div id="catalogueDraftList" class="space-y-2"></div></div>
 </div>`;
 document.getElementById("newCatalogueDraft").addEventListener("click",()=>openEditor());
 document.getElementById("exportCatalogueDrafts").addEventListener("click",downloadJson);
 document.getElementById("importCatalogueDrafts").addEventListener("change",e=>{if(e.target.files[0])importJson(e.target.files[0]);e.target.value="";});
 renderList();
}
render();
