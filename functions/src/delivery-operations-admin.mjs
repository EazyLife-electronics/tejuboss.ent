import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=(code,message)=>{throw new HttpsError(code,message);};
function authorize(request){
  if(!request.auth)fail("unauthenticated","Staff sign-in is required.");
  if(!["owner","delivery_manager"].includes(request.auth.token.role))fail("permission-denied","Delivery manager access is required.");
}
const CONFIG={
  deliveryPersonnel:{fields:["name","phone","email","active"],required:["name","phone"]},
  deliveryTypes:{fields:["name","description","active"],required:["name"]},
  deliveryCheckpoints:{fields:["name","address","active"],required:["name"]}
};
function cleanConfig(collectionName,data,partial=false){
  const schema=CONFIG[collectionName];
  if(!schema)fail("invalid-argument","Unsupported delivery configuration.");
  if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).some(k=>!schema.fields.includes(k)))fail("invalid-argument","Delivery configuration contains unsupported fields.");
  const out={};
  for(const key of schema.fields){
    if(!(key in data)){if(!partial&&schema.required.includes(key))fail("invalid-argument",key+" is required.");continue;}
    const value=data[key];
    if(key==="active"){if(typeof value!=="boolean")fail("invalid-argument","active must be true or false.");out.active=value;continue;}
    if(typeof value!=="string"||value.length>(key==="address"?500: key==="description"?300:180))fail("invalid-argument",key+" is invalid or too long.");
    out[key]=value.trim();
  }
  for(const key of schema.required)if(!partial&&!out[key])fail("invalid-argument",key+" is required.");
  if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))fail("invalid-argument","Email address is invalid.");
  return out;
}
export const manageLegacyDeliveryConfig=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
  authorize(request);
  const d=request.data||{};
  if(!d||typeof d!=="object"||Array.isArray(d)||Object.keys(d).some(k=>!["collectionName","action","id","data"].includes(k)))fail("invalid-argument","Invalid delivery configuration request.");
  const {collectionName,action,id}=d;
  if(!CONFIG[collectionName]||!["create","update","delete"].includes(action))fail("invalid-argument","Unsupported delivery configuration action.");
  if(action!=="create"&&(typeof id!=="string"||!ID.test(id)))fail("invalid-argument","Delivery configuration ID is invalid.");
  const db=getFirestore(),collectionRef=db.collection(collectionName),ref=action==="create"?collectionRef.doc():collectionRef.doc(id),auditRef=db.collection("auditLogs").doc();
  try{
    return await db.runTransaction(async tx=>{
      const current=action==="create"?null:await tx.get(ref);
      if(action!=="create"&&!current.exists)fail("not-found","Delivery configuration record no longer exists.");
      if(action==="delete"){
        tx.delete(ref);
        tx.create(auditRef,{action:"delivery_config_deleted",entityType:collectionName,entityId:id,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
        return {success:true,id};
      }
      const patch=cleanConfig(collectionName,d.data,action==="update");
      if(action==="create")tx.create(ref,{...patch,createdAt:Date.now(),updatedAt:Date.now(),createdBy:request.auth.uid});
      else tx.update(ref,{...patch,updatedAt:Date.now(),updatedBy:request.auth.uid});
      tx.create(auditRef,{action:action==="create"?"delivery_config_created":"delivery_config_updated",entityType:collectionName,entityId:ref.id,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
      return {success:true,id:ref.id};
    });
  }catch(e){if(e instanceof HttpsError)throw e;console.error("manageLegacyDeliveryConfig failed",e);throw new HttpsError("internal","Delivery configuration was not saved.");}
});
const NEXT={
  ready:["assigned","cancelled"],assigned:["picked_up","ready","cancelled"],
  picked_up:["in_transit","failed","returned"],in_transit:["checkpoint","delivered","failed","returned"],
  checkpoint:["checkpoint","delivered","failed","returned"],failed:["returned"],delivered:[],returned:[],cancelled:[]
};
export const createLegacyDelivery=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
  authorize(request);
  const d=request.data||{};
  if(!d||typeof d!=="object"||Array.isArray(d)||Object.keys(d).some(k=>!["orderId","deliveryTypeId","personnelId"].includes(k))||typeof d.orderId!=="string"||!ID.test(d.orderId))fail("invalid-argument","A valid order ID is required.");
  for(const k of ["deliveryTypeId","personnelId"])if(d[k]!=null&&(typeof d[k]!=="string"||!ID.test(d[k])))fail("invalid-argument",k+" is invalid.");
  const db=getFirestore(),orderRef=db.collection("orders").doc(d.orderId),deliveryRef=db.collection("deliveries").doc("legacy_"+createHash("sha256").update(d.orderId).digest("hex").slice(0,48)),auditRef=db.collection("auditLogs").doc();
  try{return await db.runTransaction(async tx=>{
    const orderSnap=await tx.get(orderRef);if(!orderSnap.exists)fail("not-found","Order was not found.");
    const order=orderSnap.data(),status=String(order.status||order.orderStatus||"").toLowerCase();
    if(!["confirmed","shipped"].includes(status))fail("failed-precondition","Only confirmed orders can be sent to delivery.");
    const existingQuery=await tx.get(db.collection("deliveries").where("orderId","==",d.orderId).limit(20));
    const active=existingQuery.docs.find(x=>!["cancelled","returned"].includes(x.get("status")));
    if(active)return {success:true,id:active.id,alreadyExists:true};
    const stable=await tx.get(deliveryRef);
    if(stable.exists)fail("failed-precondition","A previous delivery for this order was closed. Review its history before creating another.");
    const refs=[];
    if(d.personnelId)refs.push(tx.get(db.collection("deliveryPersonnel").doc(d.personnelId)));
    if(d.deliveryTypeId)refs.push(tx.get(db.collection("deliveryTypes").doc(d.deliveryTypeId)));
    const configs=await Promise.all(refs);
    let ci=0,person=null,type=null;
    if(d.personnelId){const snap=configs[ci++];if(!snap.exists||snap.get("active")===false)fail("failed-precondition","Selected delivery personnel is unavailable.");person=snap.data();}
    if(d.deliveryTypeId){const snap=configs[ci++];if(!snap.exists||snap.get("active")===false)fail("failed-precondition","Selected delivery type is unavailable.");type=snap.data();}
    const now=Date.now(),assigned=Boolean(person);
    tx.create(deliveryRef,{
      orderId:d.orderId,customerId:order.customerId||null,
      customerName:order.customerName||order.customer||order.customer?.name||"",
      customerPhone:order.customerPhone||order.phone||order.customer?.phone||"",
      address:order.deliveryAddress||order.address||order.fulfilment?.address||"",
      deliveryTypeId:d.deliveryTypeId||null,deliveryType:type?.name||"",
      assignedTo:d.personnelId||null,assignedToName:person?.name||"",assignedToPhone:person?.phone||"",
      status:assigned?"assigned":"ready",checkpoints:[],createdAt:now,updatedAt:now,
      assignedAt:assigned?now:null,pickedUpAt:null,outForDeliveryAt:null,deliveredAt:null,failedAt:null,returnedAt:null
    });
    tx.update(orderRef,{deliveryId:deliveryRef.id});
    tx.create(auditRef,{action:"delivery_created",entityType:"delivery",entityId:deliveryRef.id,orderId:d.orderId,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
    return {success:true,id:deliveryRef.id,alreadyExists:false};
  });}catch(e){if(e instanceof HttpsError)throw e;console.error("createLegacyDelivery failed",e);throw new HttpsError("internal","Delivery was not created.");}
});
export const updateLegacyDelivery=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
  authorize(request);
  const d=request.data||{};
  const allowed=["deliveryId","patch"];
  if(!d||typeof d!=="object"||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k))||typeof d.deliveryId!=="string"||!ID.test(d.deliveryId)||!d.patch||typeof d.patch!=="object"||Array.isArray(d.patch))fail("invalid-argument","Invalid delivery update request.");
  const patch=d.patch,keys=Object.keys(patch),allowedPatch=["status","assignedTo","assignedToName","assignedToPhone","deliveryTypeId","deliveryType","lastCheckpointId","lastCheckpointName","lastCheckpointAt","checkpoints","updatedAt","assignedAt","pickedUpAt","outForDeliveryAt","deliveredAt","failedAt","returnedAt"];
  if(!keys.length||keys.some(k=>!allowedPatch.includes(k)))fail("invalid-argument","Delivery update contains unsupported fields.");
  for(const k of ["assignedTo","deliveryTypeId","lastCheckpointId"])if(k in patch&&patch[k]!=null&&(typeof patch[k]!=="string"||!ID.test(patch[k])))fail("invalid-argument",k+" is invalid.");
  for(const k of ["assignedToName","assignedToPhone","deliveryType","lastCheckpointName"])if(k in patch&&(typeof patch[k]!=="string"||patch[k].length>180))fail("invalid-argument",k+" is invalid.");
  if("checkpoints" in patch&&(!Array.isArray(patch.checkpoints)||patch.checkpoints.length>200))fail("invalid-argument","Checkpoint history is invalid.");
  if("status" in patch&&typeof patch.status!=="string")fail("invalid-argument","Delivery status is invalid.");
  const db=getFirestore(),ref=db.collection("deliveries").doc(d.deliveryId),auditRef=db.collection("auditLogs").doc();
  try{return await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)fail("not-found","Delivery record no longer exists.");
    const current=snap.data(),next={...patch};
    if("status" in next){
      if(!Object.hasOwn(NEXT,next.status))fail("invalid-argument","Unknown delivery status.");
      if(next.status!==current.status&&!(NEXT[current.status]||[]).includes(next.status))fail("failed-precondition","This delivery status transition is not allowed.");
      if(next.status===current.status&&next.status!=="checkpoint")fail("failed-precondition","Delivery is already in that status.");
      const now=Date.now(),timeFields={picked_up:"pickedUpAt",in_transit:"outForDeliveryAt",delivered:"deliveredAt",failed:"failedAt",returned:"returnedAt"};
      if(timeFields[next.status]&&next.status!==current.status)next[timeFields[next.status]]=now;
      if(next.status==="assigned")next.assignedAt=current.assignedAt||now;
    }
    const reads=[];
    if("assignedTo" in next&&next.assignedTo)reads.push(["person",tx.get(db.collection("deliveryPersonnel").doc(next.assignedTo))]);
    if("deliveryTypeId" in next&&next.deliveryTypeId)reads.push(["type",tx.get(db.collection("deliveryTypes").doc(next.deliveryTypeId))]);
    if("lastCheckpointId" in next&&next.lastCheckpointId)reads.push(["checkpoint",tx.get(db.collection("deliveryCheckpoints").doc(next.lastCheckpointId))]);
    const resolved=await Promise.all(reads.map(x=>x[1]));
    for(let i=0;i<reads.length;i++){
      const [kind]=reads[i],record=resolved[i];
      if(!record.exists||record.get("active")===false)fail("failed-precondition",`Selected delivery ${kind} is unavailable.`);
      if(kind==="person"){next.assignedToName=record.get("name")||"";next.assignedToPhone=record.get("phone")||"";}
      if(kind==="type")next.deliveryType=record.get("name")||"";
      if(kind==="checkpoint"){
        if(!Array.isArray(next.checkpoints)||next.checkpoints.length!==(current.checkpoints||[]).length+1)fail("invalid-argument","A checkpoint update must append exactly one checkpoint.");
        const last=next.checkpoints[next.checkpoints.length-1];
        if(!last||last.checkpointId!==next.lastCheckpointId)fail("invalid-argument","Checkpoint history must match the selected checkpoint.");
        next.lastCheckpointName=record.get("name")||"";
        next.lastCheckpointAt=Date.now();
      }
    }
    if("assignedTo" in next&&!next.assignedTo){next.assignedToName="";next.assignedToPhone="";}
    if("deliveryTypeId" in next&&!next.deliveryTypeId)next.deliveryType="";
    next.updatedAt=Date.now();
    tx.update(ref,next);
    tx.create(auditRef,{action:"delivery_updated",entityType:"delivery",entityId:d.deliveryId,fields:keys,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
    return {success:true};
  });}catch(e){if(e instanceof HttpsError)throw e;console.error("updateLegacyDelivery failed",e);throw new HttpsError("internal","Delivery update was not saved.");}
});
