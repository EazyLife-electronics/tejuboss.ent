import {initFirebase} from "../../js/firebase.mjs";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const {app}=initFirebase(),functions=getFunctions(app,"europe-west1");
const listOrders=httpsCallable(functions,"listPendingCommerceOrders"),decideOrder=httpsCallable(functions,"decideOrder");
const host=document.getElementById("commerceOrderQueue");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=k=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(k||0)/100);
let busy=false;
function render(orders,limited){
 host.innerHTML='<section class="bg-white rounded-2xl border p-4 space-y-3"><div class="flex items-center justify-between gap-2"><div><h2 class="font-black text-base">Structured checkout orders</h2><p class="text-xs text-gray-500">Only new orders awaiting staff confirmation are shown.</p></div><button id="refreshCommerceOrders" class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold">Refresh</button></div><div class="space-y-3" id="commerceOrderCards">'+(orders.length?orders.map(o=>{
 const f=o.fulfilment||{},c=o.customer||{};
 return '<article class="rounded-xl border p-3 space-y-3" data-order="'+esc(o.id)+'"><div class="flex items-start justify-between gap-2"><div><p class="text-xs font-black break-all">Order '+esc(o.id)+'</p><p class="text-sm font-bold">'+esc(c.name||"Customer")+'</p><p class="text-xs text-gray-500">'+esc(c.phone||"")+(c.email?" · "+esc(c.email):"")+'</p></div><strong class="text-sm whitespace-nowrap">'+money(o.grandTotalMinor)+'</strong></div><div class="rounded-lg bg-gray-50 p-2 text-xs"><p><b>Fulfilment:</b> '+esc(f.method||"")+(f.method==="delivery"?" · "+esc(f.area||""):"")+'</p><p>'+esc(f.address||"Pickup")+'</p><p><b>Payment:</b> '+esc(o.paymentStatus)+' (separate from order confirmation)</p></div><div class="space-y-1">'+o.lines.map(line=>'<div class="flex justify-between gap-2 text-xs"><span>'+esc(line.productName||line.name||line.productId)+' · '+esc(line.variantId)+' / '+esc(line.sellingOptionId)+' × '+esc(line.quantity)+'</span><b>'+money(line.totalMinor)+'</b></div>').join("")+'</div><div class="border-t pt-2 text-xs space-y-1"><div class="flex justify-between"><span>Subtotal</span><span>'+money(o.subtotalMinor)+'</span></div><div class="flex justify-between"><span>Discount</span><span>'+money(o.discountMinor)+'</span></div><div class="flex justify-between"><span>Delivery</span><span>'+money(o.deliveryFeeMinor)+'</span></div><div class="flex justify-between font-black"><span>Total</span><span>'+money(o.grandTotalMinor)+'</span></div></div>'+(o.note?'<p class="text-xs text-gray-500">Customer note: '+esc(o.note)+'</p>':"")+'<div class="grid grid-cols-2 gap-2"><button data-decision="reject" data-id="'+esc(o.id)+'" class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">Reject order</button><button data-decision="confirm" data-id="'+esc(o.id)+'" class="rounded-xl bg-gray-900 p-3 text-xs font-bold text-white">Confirm and deduct stock</button></div></article>';
 }).join(""):'<p class="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500">No structured orders are awaiting confirmation.</p>')+'</div>'+(limited?'<p class="text-xs text-amber-700">Showing the first 100 pending orders.</p>':"")+'</section>';
 host.querySelector("#refreshCommerceOrders").onclick=load;
 host.querySelectorAll("[data-decision]").forEach(button=>button.onclick=async()=>{
  if(busy)return;const id=button.dataset.id,decision=button.dataset.decision;
  const question=decision==="confirm"?"Confirm this order? This will deduct the recorded stock quantities atomically.":"Reject this order? Rejected orders do not deduct stock.";
  if(!window.confirm(question))return;
  busy=true;button.disabled=true;button.textContent=decision==="confirm"?"Confirming...":"Rejecting...";
  try{await decideOrder({orderId:id,decision});await load();}
  catch(e){window.alert(e.message||"Order decision failed. Refresh and review the order.");button.disabled=false;button.textContent=decision==="confirm"?"Confirm and deduct stock":"Reject order";}
  finally{busy=false;}
 });
}
async function load(){host.innerHTML='<p class="bg-white rounded-xl p-4 text-xs text-gray-500">Loading pending orders...</p>';try{const r=await listOrders({});render(r.data.orders||[],r.data.limited===true);}catch(e){host.innerHTML='<p class="bg-amber-50 text-amber-800 rounded-xl p-4 text-xs">The secure order queue requires an authorized order manager account and App Check. '+esc(e.message)+'</p>';}}
let started=false;
const ordersTab=document.querySelector('[data-tab="orders"]');
ordersTab?.addEventListener("click",()=>{if(!started){started=true;load();}});
