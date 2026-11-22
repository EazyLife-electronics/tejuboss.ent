import { onCall,HttpsError } from "firebase-functions/v2/https";
import { FieldValue,getFirestore } from "firebase-admin/firestore";
import { validateDeliveryPolicyInput,buildDeliveryPolicyDocument,deliveryPolicyForAdmin } from "./domain/delivery-policy-config.mjs";
function authorize(request){if(!request.auth)throw new HttpsError("unauthenticated","Staff sign-in is required.");const role=request.auth.token.role;if(role!=="owner"&&role!=="delivery_manager")throw new HttpsError("permission-denied","Delivery manager access is required.");return role;}
export const getDeliveryPolicy=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
 authorize(request);const snap=await getFirestore().collection("deliveryPolicies").doc("active").get();return deliveryPolicyForAdmin(snap.exists?snap.data():null);
});
export const saveDeliveryPolicy=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
 const role=authorize(request);let input;try{input=validateDeliveryPolicyInput(request.data);}catch(e){throw new HttpsError("invalid-argument",e.message);}
 const db=getFirestore(),ref=db.collection("deliveryPolicies").doc("active"),audit=db.collection("auditLogs").doc(),now=Date.now();
 try{return await db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null,version=Number.isSafeInteger(current?.versionNumber)?current.versionNumber:0;
  if(input.expectedVersion!==version)throw new HttpsError("aborted","Delivery policy changed since it was loaded. Refresh before saving.",{currentVersion:version});
  const next=buildDeliveryPolicyDocument(input,version+1,request.auth.uid,now);
  tx.set(ref,{...next,updatedAt:FieldValue.serverTimestamp()});
  tx.create(audit,{action:"delivery_policy_updated",entityType:"delivery_policy",entityId:"active",version:version+1,enabled:next.enabled,method:next.method,actorUid:request.auth.uid,actorRole:role,createdAt:FieldValue.serverTimestamp()});
  return {success:true,version:next.version,enabled:next.enabled,method:next.method};
 });}catch(e){if(e instanceof HttpsError)throw e;console.error("saveDeliveryPolicy failed",e);throw new HttpsError("internal","Delivery policy was not saved.");}
});
