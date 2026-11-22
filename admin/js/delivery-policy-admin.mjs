import {initFirebase} from "../../js/firebase.mjs";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const {app}=initFirebase(),functions=getFunctions(app,"europe-west1");
const getPolicy=httpsCallable(functions,"getDeliveryPolicy"),savePolicy=httpsCallable(functions,"saveDeliveryPolicy");
const host=document.getElementById("deliveryPolicyConfig");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const naira=kobo=>(Number(kobo||0)/100).toFixed(2);
function minor(value){const n=Number(value);if(!Number.isFinite(n)||n<0||Math.round(n*100)!==n*100)throw new Error("Enter a valid non-negative Naira amount with at most two decimal places.");const k=Math.round(n*100);if(!Number.isSafeInteger(k))throw new Error("Fee is too large.");return k;}
let version=0,areas=[];
function render(){
 host.innerHTML='<section class="bg-white rounded-2xl border p-4 space-y-4"><div><h2 class="font-black text-base">Delivery pricing policy</h2><p class="text-xs text-gray-500">Configure delivery methods and service areas. Delivery remains disabled until you explicitly enable and save a complete policy.</p></div><label class="flex items-center gap-2 text-sm font-bold"><input id="deliveryEnabled" type="checkbox"> Enable delivery at checkout</label><label class="block text-xs font-bold">Charging method<select id="deliveryMethod" class="mt-1 w-full rounded-xl border bg-gray-50 p-3 text-sm"><option value="flat_per_order">One flat fee per order</option><option value="per_selling_unit">Fee per selling unit</option></select></label><label class="block text-xs font-bold">Base delivery fee (₦)<input id="deliveryBaseFee" type="number" min="0" step="0.01" class="mt-1 w-full rounded-xl border bg-gray-50 p-3 text-sm" value="0"><span class="font-normal text-gray-400">Flat fee per order, or default fee for each selling unit.</span></label><div class="space-y-2"><div class="flex justify-between items-center"><div><h3 class="text-sm font-black">Delivery areas</h3><p class="text-[11px] text-gray-500">Use stable IDs in checkout, e.g. ibadan_southwest.</p></div><button id="addDeliveryArea" type="button" class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold">Add area</button></div><div id="deliveryAreas" class="space-y-2"></div></div><button id="saveDeliveryPolicy" class="w-full rounded-xl bg-gray-900 p-3 text-sm font-bold text-white">Save delivery configuration</button><p id="deliveryPolicyStatus" class="hidden rounded-xl bg-gray-100 p-3 text-xs break-words"></p></section>';
 const rows=host.querySelector("#deliveryAreas");
 const draw=()=>{rows.innerHTML=areas.map((a,i)=>'<div class="rounded-xl border p-3 space-y-2"><div class="grid grid-cols-2 gap-2"><label class="text-[10px] font-bold">Stable area ID<input data-area="id" data-index="'+i+'" value="'+esc(a.id)+'" placeholder="ibadan_southwest" class="mt-1 w-full rounded-lg border p-2 text-xs"></label><label class="text-[10px] font-bold">Display name<input data-area="label" data-index="'+i+'" value="'+esc(a.label)+'" placeholder="Ibadan Southwest" class="mt-1 w-full rounded-lg border p-2 text-xs"></label></div><div class="flex items-end gap-2"><label class="flex-1 text-[10px] font-bold">Area fee (₦)<input data-area="fee" data-index="'+i+'" type="number" min="0" step="0.01" value="'+esc(a.fee)+'" class="mt-1 w-full rounded-lg border p-2 text-xs"></label><label class="flex items-center gap-1 text-xs"><input data-area="active" data-index="'+i+'" type="checkbox" '+(a.active?'checked':'')+'> Active</label><button type="button" data-remove-area="'+i+'" class="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">Remove</button></div></div>').join("")||'<p class="text-xs text-gray-400">No areas added yet.</p>';};
 draw();
 host.querySelector("#addDeliveryArea").onclick=()=>{areas.push({id:"",label:"",fee:"0",active:true});draw();};
 rows.addEventListener("input",e=>{const el=e.target;if(!el.dataset.area)return;const a=areas[Number(el.dataset.index)];a[el.dataset.area]=el.value;});
 rows.addEventListener("change",e=>{const el=e.target;if(el.dataset.area==="active")areas[Number(el.dataset.index)].active=el.checked;});
 rows.addEventListener("click",e=>{const b=e.target.closest("[data-remove-area]");if(b){areas.splice(Number(b.dataset.removeArea),1);draw();}});
 host.querySelector("#saveDeliveryPolicy").onclick=async()=>{
  const status=host.querySelector("#deliveryPolicyStatus");status.classList.remove("hidden");status.textContent="Validating and saving policy...";
  try{
   const payload={enabled:host.querySelector("#deliveryEnabled").checked,method:host.querySelector("#deliveryMethod").value,baseFeeMinor:minor(host.querySelector("#deliveryBaseFee").value),optionFeesMinor:{},areas:areas.map(a=>({id:a.id.trim(),label:a.label.trim(),feeMinor:minor(a.fee),active:a.active})),expectedVersion:version};
   const result=await savePolicy(payload);version++;status.textContent="Saved as "+result.data.version+". Delivery "+(result.data.enabled?"is enabled":"remains disabled")+". Existing orders keep their original fee snapshots.";
  }catch(e){status.textContent=e.message||"Could not save delivery policy.";}
 };
}
async function start(){
 host.innerHTML='<p class="bg-white rounded-xl p-4 text-xs text-gray-500">Loading delivery configuration...</p>';
 try{const r=await getPolicy({}),p=r.data;version=p.versionNumber||0;areas=(p.areas||[]).map(a=>({...a,fee:naira(a.feeMinor)}));render();host.querySelector("#deliveryEnabled").checked=p.enabled===true;host.querySelector("#deliveryMethod").value=p.method||"flat_per_order";host.querySelector("#deliveryBaseFee").value=naira(p.baseFeeMinor);}
 catch(e){host.innerHTML='<p class="bg-amber-50 text-amber-800 rounded-xl p-4 text-xs">Delivery settings require an authorized delivery manager account and App Check. '+esc(e.message)+'</p>';}
}
let started=false;
const deliveryTab=document.querySelector('[data-tab="delivery"]');
deliveryTab?.addEventListener("click",()=>{if(!started){started=true;start();}});
