import {onCall,HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
export const listPendingCommerceOrders=onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Staff sign-in is required.");
 const role=request.auth.token.role;if(role!=="owner"&&role!=="order_manager")throw new HttpsError("permission-denied","Order manager access is required.");
 const snap=await getFirestore().collection("orders").where("status","==","awaiting_confirmation").orderBy("createdAtMillis","desc").limit(100).get();
 return {orders:snap.docs.map(doc=>{const d=doc.data();return {id:doc.id,customer:d.customer||{},fulfilment:d.fulfilment||{},lines:Array.isArray(d.lines)?d.lines:[],subtotalMinor:d.subtotalMinor??0,discountMinor:d.discountMinor??0,deliveryFeeMinor:d.deliveryFeeMinor??0,grandTotalMinor:d.grandTotalMinor??0,currency:d.currency||"NGN",createdAtMillis:d.createdAtMillis??null,note:d.note||"",paymentStatus:d.paymentStatus||"unpaid"};}),limited:snap.size===100};
});
