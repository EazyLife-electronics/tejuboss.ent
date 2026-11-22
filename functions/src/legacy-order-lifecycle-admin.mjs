import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID=/^[A-Za-z0-9_.-]{1,128}$/;
const CONFIRMED=new Set(["confirmed","shipped","delivered"]);
const REVERSED=new Set(["cancelled","returned"]);
function authorize(request){
  if(!request.auth) throw new HttpsError("unauthenticated","Staff sign-in is required.");
  if(!["owner","order_manager"].includes(request.auth.token.role)) throw new HttpsError("permission-denied","Order manager access is required.");
}
function valid(data){
  if(!data||typeof data!=="object"||Array.isArray(data)) throw new HttpsError("invalid-argument","Request must be an object.");
  const action=data.action;
  if(action==="status"){
    if(Object.keys(data).some(k=>!["action","orderId","status"].includes(k))||typeof data.orderId!=="string"||!ID.test(data.orderId)||!["new","confirmed","shipped","delivered","cancelled","returned"].includes(data.status)) throw new HttpsError("invalid-argument","Order status request is invalid.");
  }else if(action==="cancel"){
    if(Object.keys(data).some(k=>!["action","orderId","reason","customerNote","internalNote"].includes(k))||typeof data.orderId!=="string"||!ID.test(data.orderId)) throw new HttpsError("invalid-argument","Cancellation request is invalid.");
    for(const k of ["reason","customerNote","internalNote"]) if(data[k]!=null&&(typeof data[k]!=="string"||data[k].length>1500)) throw new HttpsError("invalid-argument",k+" is invalid.");
  }else throw new HttpsError("invalid-argument","Unsupported order action.");
  return data;
}
async function applyLegacyStock(tx,firestore,order,restore,actorUid){
  const grouped=new Map();
  for(const item of Array.isArray(order.items)?order.items:[]){
    if(!item?.productId||!item?.variantId) throw new HttpsError("failed-precondition","Order item lacks a stable product/variant ID; reconcile manually.");
    const quantity=Number(item.quantity);
    if(!Number.isSafeInteger(quantity)||quantity<=0) throw new HttpsError("failed-precondition","Order quantity is invalid.");
    const key=item.productId+"::"+item.variantId;
    const current=grouped.get(key)||{productId:item.productId,variantId:item.variantId,quantity:0,item};
    current.quantity+=quantity;grouped.set(key,current);
  }
  const changes=[];
  for(const row of grouped.values()){
    const ref=firestore.collection("products").doc(row.productId);
    const snap=await tx.get(ref);
    if(!snap.exists) throw new HttpsError("failed-precondition","An order product no longer exists.");
    const data=snap.data(), variants=Array.isArray(data.variants)?[...data.variants]:[];
    const index=variants.findIndex(v=>v.id===row.variantId);
    if(index<0) throw new HttpsError("failed-precondition","An order variant no longer exists.");
    const current=Number(variants[index].stockQty);
    if(!Number.isSafeInteger(current)||current<0) throw new HttpsError("failed-precondition","Legacy stock quantity is invalid; reconcile manually.");
    const next=current+(restore?row.quantity:-row.quantity);
    if(next<0) throw new HttpsError("failed-precondition","Insufficient stock to confirm this order.");
    variants[index]={...variants[index],stockQty:next,inStock:next>0};
    changes.push({ref,data,variants,index,current,next,row});
  }
  for(const c of changes){
    tx.update(c.ref,{variants:c.variants,inStock:c.variants.some(v=>Number(v.stockQty||0)>0),updatedAt:FieldValue.serverTimestamp(),updatedBy:actorUid});
    tx.create(firestore.collection("inventoryMovements").doc(),{
      productId:c.row.productId,variantId:c.row.variantId,sku:c.variants[c.index].sku||c.row.item.sku||"",
      productName:c.data.name||c.row.item.name||"",variantLabel:c.row.item.variant||"",
      type:restore?"return":"sale",quantity:restore?c.row.quantity:-c.row.quantity,
      previousQty:c.current,newQty:c.next,reason:restore?"Legacy order reversal":"Legacy order confirmed",
      orderId:order.id||order.trackingCode||"",reference:order.trackingCode||order.id||"",
      createdAt:FieldValue.serverTimestamp(),createdBy:actorUid
    });
  }
}
export const manageLegacyOrderLifecycle=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
  authorize(request);const data=valid(request.data);const firestore=getFirestore();
  const orderRef=firestore.collection("orders").doc(data.orderId);const auditRef=firestore.collection("auditLogs").doc();
  return firestore.runTransaction(async tx=>{
    const snap=await tx.get(orderRef);if(!snap.exists) throw new HttpsError("not-found","Order was not found.");
    const order={id:snap.id,...snap.data()},old=String(order.status||"new").toLowerCase();
    const next=data.action==="cancel"?"cancelled":data.status;
    if(old===next)return {success:true,outcome:"unchanged",orderId:data.orderId};
    const deduct=CONFIRMED.has(next)&&!CONFIRMED.has(old)&&order.inventoryApplied!==true;
    const restore=REVERSED.has(next)&&order.inventoryApplied===true&&order.inventoryReturned!==true;
    if(deduct) await applyLegacyStock(tx,firestore,order,false,request.auth.uid);
    if(restore) await applyLegacyStock(tx,firestore,order,true,request.auth.uid);
    tx.update(orderRef,{
      status:next,updatedAt:FieldValue.serverTimestamp(),updatedBy:request.auth.uid,
      ...(deduct?{inventoryApplied:true,inventoryReturned:false,inventoryAppliedAt:FieldValue.serverTimestamp()}:{}),
      ...(restore?{inventoryReturned:true,inventoryReturnedAt:FieldValue.serverTimestamp()}:{}),
      ...(data.action==="cancel"?{cancelReason:data.reason||null,cancelCustomerNote:data.customerNote||null,cancelInternalNote:data.internalNote||null,cancelledAt:FieldValue.serverTimestamp()}: {})
    });
    tx.create(auditRef,{action:next==="cancelled"?"legacy_order_cancelled":"legacy_order_status_changed",entityType:"legacy_order",entityId:data.orderId,previousStatus:old,nextStatus:next,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
    return {success:true,outcome:next,orderId:data.orderId,inventoryDeducted:deduct,inventoryRestored:restore};
  });
});
