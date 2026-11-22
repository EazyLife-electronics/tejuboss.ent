import {initFirebase} from "../../js/firebase.mjs";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const {app}=initFirebase(),functions=getFunctions(app,"europe-west1");
const listArchive=httpsCallable(functions,"listCommerceOrderArchive");
const host=document.getElementById("commerceOrderArchive");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=k=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:2}).format(Number(k||0)/100);
const localDate=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return y+"-"+m+"-"+day;};
const today=new Date(),monthAgo=new Date(today);monthAgo.setDate(today.getDate()-30);
host.innerHTML='<section class="rounded-2xl border bg-white p-4 space-y-3"><div><h2 class="font-black text-base">Order archive</h2><p class="text-xs text-gray-500">Find completed or rejected orders by order date. Read-only, separate from the active queue.</p></div><form id="archiveRange" class="grid grid-cols-1 sm:grid-cols-2 gap-2"><label class="text-xs font-bold">From date<input id="archiveFrom" type="date" required value="'+localDate(monthAgo)+'" class="mt-1 w-full rounded-xl border p-3 text-sm"></label><label class="text-xs font-bold">To date<input id="archiveTo" type="date" required value="'+localDate(today)+'" class="mt-1 w-full rounded-xl border p-3 text-sm"></label><button class="sm:col-span-2 rounded-xl bg-gray-900 p-3 text-sm font-bold text-white">Search archive</button></form><p id="archiveStatus" class="text-xs text-gray-500">Choose a date range and search.</p><div id="archiveResults" class="space-y-2"></div><button id="archiveNext" class="hidden w-full rounded-xl border p-3 text-sm font-bold">Load next archive page</button></section>';
const form=host.querySelector("#archiveRange"),status=host.querySelector("#archiveStatus"),results=host.querySelector("#archiveResults"),next=host.querySelector("#archiveNext");
let range=null,cursor=null,hasMore=false,loading=false;
function draw(orders,append=false){
 const html=orders.map(o=>'<article class="rounded-xl border p-3 space-y-2"><div class="flex justify-between gap-2"><div><p class="text-xs font-black break-all">Order '+esc(o.id)+'</p><p class="text-xs text-gray-500">'+esc(o.createdAtMillis?new Date(o.createdAtMillis).toLocaleString("en-NG"):"Date unavailable")+'</p></div><b class="text-sm whitespace-nowrap">'+money(o.grandTotalMinor)+'</b></div><p class="text-xs"><b>'+esc(o.status)+' / '+esc(o.fulfilmentStatus.replaceAll("_"," "))+'</b> · '+esc(o.paymentStatus)+' · received '+money(o.paymentTotalMinor)+'</p>'+(o.customer?.name?'<p class="text-xs">'+esc(o.customer.name)+(o.customer.phone?' · '+esc(o.customer.phone):"")+'</p>':"")+(o.fulfilment?.area?'<p class="text-xs text-gray-500">'+esc(o.fulfilment.area)+'</p>':"")+'<div class="text-xs space-y-1">'+(o.lines||[]).map(l=>'<p>'+esc(l.name)+' × '+esc(l.quantity)+'</p>').join("")+'</div></article>').join("");
 results.innerHTML=append?results.innerHTML+html:html;
}
async function fetchPage(append=false){
 if(loading||!range)return;loading=true;next.disabled=true;status.textContent="Searching completed and rejected orders...";
 try{const r=await listArchive({fromMillis:range.fromMillis,toMillis:range.toMillis,cursor});const d=r.data||{};draw(d.orders||[],append);cursor=d.cursor;hasMore=d.hasMore===true;next.classList.toggle("hidden",!hasMore);status.textContent=(d.orders||[]).length+" archived orders found in this page"+(d.scanned?" · "+d.scanned+" records scanned":"")+(d.privacyLimited?" · Customer contact details hidden for this role":"")+(hasMore?" · More records available":" · End of archive range");}
 catch(e){status.textContent=e.message||"Could not search archive.";next.classList.add("hidden");}
 finally{loading=false;next.disabled=false;}
}
form.addEventListener("submit",e=>{e.preventDefault();const from=host.querySelector("#archiveFrom").value,to=host.querySelector("#archiveTo").value;if(!from||!to||from>to){status.textContent="Choose a valid start and end date.";return;}const fromMillis=new Date(from+"T00:00:00").getTime(),toMillis=new Date(to+"T23:59:59.999").getTime();if(toMillis-fromMillis>90*86400000){status.textContent="Search ranges are limited to 90 days. Use a shorter range.";return;}range={fromMillis,toMillis};cursor=null;hasMore=false;fetchPage(false);});
next.addEventListener("click",()=>{if(hasMore)fetchPage(true);});
