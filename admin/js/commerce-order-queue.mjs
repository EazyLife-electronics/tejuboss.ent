import {initFirebase} from "../../js/firebase.mjs";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const {app}=initFirebase(),functions=getFunctions(app,"europe-west1");
const listOrders=httpsCallable(functions,"listPendingCommerceOrders"),decideOrder=httpsCallable(functions,"decideOrder"),updateFulfilment=httpsCallable(functions,"updateOrderFulfilment"),recordPayment=httpsCallable(functions,"recordOrderPayment"),paymentHistory=httpsCallable(functions,"listOrderPaymentHistory");
const host=document.getElementById("commerceOrderQueue");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=k=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(k||0)/100);
const nextStep=o=>{const s=o.fulfilmentStatus||"unfulfilled",m=o.fulfilment?.method;if(s==="unfulfilled")return ["preparing","Start preparation"];if(s==="preparing")return m==="pickup"?["ready_for_pickup","Mark ready for pickup"]:["dispatched","Mark dispatched"];if(s==="ready_for_pickup")return ["fulfilled","Mark collected"];if(s==="dispatched")return ["fulfilled","Mark delivered"];return null;};
let busy=false;
function render(orders,limited,permissions={}) {
 const cards=orders.map(o=>{
  const f=o.fulfilment||{},c=o.customer||{},pending=o.status==="awaiting_confirmation",step=nextStep(o);
  const outstanding=Math.max(0,o.grandTotalMinor-(o.paymentTotalMinor||0));
  const state=pending?"awaiting_confirmation":(o.fulfilmentStatus||"unfulfilled");
  const searchText=[o.id,c.name,c.phone,c.email,f.area,f.address,...(o.lines||[]).flatMap(line=>[line.productName,line.name,line.productId,line.variantId,line.sellingOptionId])].filter(Boolean).join(" ").toLowerCase();
  const status=pending?"Awaiting confirmation":state.replaceAll("_"," ");
  const paymentControl=!pending&&permissions.recordPayment&&outstanding>0
   ? '<button data-payment="1" data-id="'+esc(o.id)+'" data-remaining="'+outstanding+'" class="w-full rounded-xl border p-3 text-xs font-bold">Record payment received</button>' : "";
  const historyControl=permissions.recordPayment ? '<button data-history="1" data-id="'+esc(o.id)+'" class="w-full rounded-xl border p-3 text-xs font-bold">View payment history</button><div data-history-panel="'+esc(o.id)+'" class="hidden rounded-xl bg-gray-50 p-3 text-xs space-y-2"></div>' : "";
  const orderControls=pending&&permissions.manageOrders
   ? '<div class="grid grid-cols-2 gap-2"><button data-decision="reject" data-id="'+esc(o.id)+'" class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">Reject order</button><button data-decision="confirm" data-id="'+esc(o.id)+'" class="rounded-xl bg-gray-900 p-3 text-xs font-bold text-white">Confirm and deduct stock</button></div>' : "";
  const fulfilmentControl=!pending&&permissions.manageOrders&&step
   ? '<button data-next="'+esc(step[0])+'" data-current="'+esc(o.fulfilmentStatus||"unfulfilled")+'" data-id="'+esc(o.id)+'" class="w-full rounded-xl bg-gray-900 p-3 text-xs font-bold text-white">'+esc(step[1])+'</button>' : "";
  const footer=pending&&!permissions.manageOrders
   ? '<p class="text-xs text-gray-500">Order approval is managed by order staff.</p>'
   : (!pending&&!permissions.manageOrders
      ? '<p class="text-xs text-gray-500">Fulfilment updates are managed by order staff.</p>'
      : (!pending&&!step ? '<p class="rounded-lg bg-green-50 p-3 text-xs font-bold text-green-800">Fulfilment completed</p>' : ""));
  return '<article class="rounded-xl border p-3 space-y-3" data-order="'+esc(o.id)+'" data-state="'+esc(state)+'" data-payment-due="'+(outstanding>0?"yes":"no")+'" data-search="'+esc(searchText)+'"><div class="flex items-start justify-between gap-2"><div><p class="text-xs font-black break-all">Order '+esc(o.id)+'</p><p class="text-sm font-bold">'+esc(c.name||"Customer")+'</p><p class="text-xs text-gray-500">'+esc(c.phone||"")+(c.email?" · "+esc(c.email):"")+'</p></div><strong class="text-sm whitespace-nowrap">'+money(o.grandTotalMinor)+'</strong></div><div class="rounded-lg bg-gray-50 p-2 text-xs"><p><b>Order:</b> '+esc(o.status)+'</p><p><b>Fulfilment:</b> '+esc(status)+'</p><p><b>Method:</b> '+esc(f.method||"")+(f.method==="delivery"?" · "+esc(f.area||""):"")+'</p><p>'+esc(f.address||"Pickup")+'</p><p><b>Payment:</b> '+esc(o.paymentStatus)+' · received '+money(o.paymentTotalMinor)+' · outstanding '+money(outstanding)+'</p></div><div class="space-y-1">'+o.lines.map(line=>'<div class="flex justify-between gap-2 text-xs"><span>'+esc(line.productName||line.name||line.productId)+' · '+esc(line.variantId)+' / '+esc(line.sellingOptionId)+' × '+esc(line.quantity)+'</span><b>'+money(line.totalMinor)+'</b></div>').join("")+'</div><div class="border-t pt-2 text-xs space-y-1"><div class="flex justify-between"><span>Subtotal</span><span>'+money(o.subtotalMinor)+'</span></div><div class="flex justify-between"><span>Discount</span><span>'+money(o.discountMinor)+'</span></div><div class="flex justify-between"><span>Delivery</span><span>'+money(o.deliveryFeeMinor)+'</span></div><div class="flex justify-between font-black"><span>Total</span><span>'+money(o.grandTotalMinor)+'</span></div></div>'+(o.note?'<p class="text-xs text-gray-500">Customer note: '+esc(o.note)+'</p>':"")+paymentControl+historyControl+orderControls+fulfilmentControl+footer+'</article>';
 }).join("");
 host.innerHTML='<section class="bg-white rounded-2xl border p-4 space-y-3"><div class="flex items-center justify-between gap-2"><div><h2 class="font-black text-base">Structured checkout orders</h2><p class="text-xs text-gray-500">New orders and confirmed orders in preparation, pickup or delivery.</p></div><button id="refreshCommerceOrders" class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold">Refresh</button></div><div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><input id="commerceOrderSearch" type="search" placeholder="Search order, customer, phone or item" class="w-full rounded-xl border p-3 text-sm"><select id="commerceOrderFilter" class="w-full rounded-xl border p-3 text-sm"><option value="all">All active orders</option><option value="awaiting_confirmation">Awaiting confirmation</option><option value="unfulfilled">Not started</option><option value="preparing">Preparing</option><option value="ready_for_pickup">Ready for pickup</option><option value="dispatched">Dispatched</option><option value="fulfilled">Completed</option><option value="payment_due">Payment outstanding</option></select></div><p id="commerceOrderCount" class="text-xs text-gray-500"></p><div id="commerceOrderCards" class="space-y-3">'+(cards||'<p class="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500">No active structured orders.</p>')+'</div>'+(limited?'<p class="text-xs text-amber-700">Showing a limited set of active orders.</p>':"")+'</section>';
 host.querySelector("#refreshCommerceOrders").onclick=load;
 const applyFilters=()=>{const query=(host.querySelector("#commerceOrderSearch").value||"").trim().toLowerCase(),filter=host.querySelector("#commerceOrderFilter").value;let shown=0;host.querySelectorAll("[data-order]").forEach(card=>{const stateMatch=filter==="all"||card.dataset.state===filter||(filter==="payment_due"&&card.dataset.paymentDue==="yes"),searchMatch=!query||(card.dataset.search||"").includes(query);card.hidden=!(stateMatch&&searchMatch);if(!card.hidden)shown++;});const count=host.querySelector("#commerceOrderCount");if(count)count.textContent="Showing "+shown+" of "+orders.length+" orders";};
 host.querySelector("#commerceOrderSearch").oninput=applyFilters;
 host.querySelector("#commerceOrderFilter").onchange=applyFilters;
 applyFilters();
 host.querySelectorAll("[data-decision]").forEach(button=>button.onclick=async()=>{if(busy)return;const id=button.dataset.id,decision=button.dataset.decision;if(!window.confirm(decision==="confirm"?"Confirm this order? Stock will be deducted atomically.":"Reject this order? No stock will be deducted."))return;busy=true;button.disabled=true;try{await decideOrder({orderId:id,decision});await load();}catch(e){window.alert(e.message||"Order update failed.");button.disabled=false;}finally{busy=false;}});
 host.querySelectorAll("[data-payment]").forEach(button=>button.onclick=async()=>{if(busy)return;const id=button.dataset.id,remaining=Number(button.dataset.remaining);if(!remaining){window.alert("No outstanding balance.");return;}const amountText=window.prompt("Amount received in naira. Outstanding: "+money(remaining),(remaining/100).toFixed(2));if(amountText===null)return;const amountParts=amountText.trim().split(".");if(!/^\d+(?:\.\d{1,2})?$/.test(amountText.trim())){window.alert("Enter a valid amount with no more than 2 decimal places.");return;}const amountMinor=Number(amountParts[0])*100+Number(((amountParts[1]||"")+"00").slice(0,2));if(!Number.isSafeInteger(amountMinor)||amountMinor<=0){window.alert("Enter a valid positive payment amount.");return;}const method=window.prompt("Payment method, e.g. cash, bank transfer or POS:");if(method===null||!method.trim())return;const reference=window.prompt("Optional payment reference. Leave blank if none:")||"";if(!window.confirm("Record "+money(amountMinor)+" received by "+method.trim()+"? This records the receipt only; it does not contact a bank."))return;busy=true;button.disabled=true;try{await recordPayment({orderId:id,amountMinor,method:method.trim(),reference:reference.trim(),idempotencyKey:crypto.randomUUID().replaceAll("-","")});await load();}catch(e){window.alert(e.message||"Payment could not be recorded.");button.disabled=false;}finally{busy=false;}});

 host.querySelectorAll("[data-history]").forEach(button=>button.onclick=async()=>{
  if(busy)return;
  const panel=button.parentElement.querySelector("[data-history-panel]");
  if(!panel)return;
  if(!panel.classList.contains("hidden")){panel.classList.add("hidden");return;}
  panel.classList.remove("hidden");panel.textContent="Loading receipt history...";
  busy=true;button.disabled=true;
  try{
   const result=await paymentHistory({orderId:button.dataset.id}),data=result.data||{};
   const rows=(data.payments||[]).map(p=>{
    const when=p.receivedAtMillis?new Date(p.receivedAtMillis).toLocaleString("en-NG"):"Time unavailable";
    return '<div class="border-b pb-2 space-y-1"><div class="flex justify-between gap-2"><b>'+money(p.amountMinor)+'</b><span>'+esc(when)+'</span></div><p>'+esc(p.method)+(p.reference?' · Ref: '+esc(p.reference):"")+'</p><p class="text-gray-500">Cumulative received: '+money(p.paidTotalAfterMinor)+' · '+esc(p.paymentStatusAfter)+'</p></div>';
   }).join("");
   panel.innerHTML='<div class="flex justify-between font-black"><span>Receipt history ('+(data.payments||[]).length+')</span><span>'+money(data.paymentTotalMinor)+' / '+money(data.grandTotalMinor)+'</span></div>'+(rows||'<p class="text-gray-500">No receipts have been recorded for this order.</p>')+(data.limited?'<p class="text-amber-700">Showing the first 200 receipts.</p>':"");
  }catch(e){panel.textContent=e.message||"Could not load payment history.";}
  finally{busy=false;button.disabled=false;}
 });
 host.querySelectorAll("[data-next]").forEach(button=>button.onclick=async()=>{if(busy)return;const id=button.dataset.id,nextStatus=button.dataset.next,expectedStatus=button.dataset.current;if(!window.confirm("Update fulfilment to "+nextStatus.replaceAll("_"," ")+"? Payment status will not change."))return;busy=true;button.disabled=true;try{await updateFulfilment({orderId:id,nextStatus,expectedStatus});await load();}catch(e){window.alert(e.message||"Fulfilment update failed. Refresh the queue.");button.disabled=false;}finally{busy=false;}});
}
async function load(){host.innerHTML='<p class="bg-white rounded-xl p-4 text-xs text-gray-500">Loading active orders...</p>';try{const r=await listOrders({});render(r.data.orders||[],r.data.limited===true,r.data.permissions||{});}catch(e){host.innerHTML='<p class="bg-amber-50 text-amber-800 rounded-xl p-4 text-xs">The secure order queue requires an authorized order or delivery manager account and App Check. '+esc(e.message)+'</p>';}}
let started=false;
const ordersTab=document.querySelector('[data-tab="orders"]');
ordersTab?.addEventListener("click",()=>{if(!started){started=true;load();}});
