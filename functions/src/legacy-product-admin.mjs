import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();
const PRODUCT_FIELDS = ["name","brand","category","desc","inStock","variants","upgrades"];
const VARIANT_FIELDS = ["id","color","processor","ram","rom","price","promoPrice","image","deliveryFee","deliveryRoute","bulkSavingsEnabled","bulkSavingsMode","bulkSavingsPercent","bulkSavingsMinQty","inStock"];
const UPGRADE_FIELDS = ["id","name","price"];
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

function authorize(request) {
  if (!request.auth) throw new HttpsError("unauthenticated","Staff sign-in is required.");
  const role = request.auth.token.role;
  if (!["owner","catalogue_manager"].includes(role)) throw new HttpsError("permission-denied","Catalogue manager access is required.");
  return role;
}
function assertObject(value,label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument",label+" must be an object.");
}
function validateProduct(raw) {
  assertObject(raw,"Product");
  if (Object.keys(raw).some(k=>!PRODUCT_FIELDS.includes(k))) throw new HttpsError("invalid-argument","Product contains unsupported fields.");
  const product={...raw};
  if (typeof product.name!=="string" || !product.name.trim() || product.name.length>180) throw new HttpsError("invalid-argument","Product name is required (max 180 characters).");
  for (const field of ["brand","category","desc"]) {
    if (field in product && (typeof product[field]!=="string" || product[field].length>(field==="desc"?5000:160))) throw new HttpsError("invalid-argument",field+" is invalid.");
  }
  if ("inStock" in product && typeof product.inStock!=="boolean") throw new HttpsError("invalid-argument","Product stock visibility must be boolean.");
  if (!Array.isArray(product.variants) || product.variants.length<1 || product.variants.length>100) throw new HttpsError("invalid-argument","A product must have 1 to 100 variants.");
  product.variants=product.variants.map((v,i)=>{
    assertObject(v,"Variant "+(i+1));
    if(Object.keys(v).some(k=>!VARIANT_FIELDS.includes(k))) throw new HttpsError("invalid-argument","Variant contains unsupported fields.");
    if(typeof v.id!=="string" || !ID.test(v.id)) throw new HttpsError("invalid-argument","Variant ID is invalid.");
    for(const field of ["price","promoPrice","deliveryFee","bulkSavingsPercent","bulkSavingsMinQty"]) if(v[field]!=null && (!Number.isFinite(v[field]) || v[field]<0 || v[field]>1000000000)) throw new HttpsError("invalid-argument",field+" is invalid.");
    if(v.price===undefined || !Number.isSafeInteger(v.price)) throw new HttpsError("invalid-argument","Variant price must be an integer naira amount.");
    if(v.promoPrice!=null && !Number.isSafeInteger(v.promoPrice)) throw new HttpsError("invalid-argument","Promo price must be an integer.");
    if(v.deliveryFee!=null && !Number.isSafeInteger(v.deliveryFee)) throw new HttpsError("invalid-argument","Delivery fee must be an integer.");
    if(v.inStock!=null && typeof v.inStock!=="boolean") throw new HttpsError("invalid-argument","Variant stock visibility must be boolean.");
    for(const field of ["color","processor","ram","rom","image","deliveryRoute","bulkSavingsMode"]) if(v[field]!=null && (typeof v[field]!=="string" || v[field].length>2048)) throw new HttpsError("invalid-argument",field+" is invalid.");
    return v;
  });
  if(product.upgrades!==undefined){
    if(!Array.isArray(product.upgrades)||product.upgrades.length>100) throw new HttpsError("invalid-argument","Upgrades must be a bounded list.");
    product.upgrades=product.upgrades.map(u=>{
      assertObject(u,"Upgrade");
      if(Object.keys(u).some(k=>!UPGRADE_FIELDS.includes(k))||typeof u.name!=="string"||!u.name.trim()||!Number.isSafeInteger(u.price)||u.price<0) throw new HttpsError("invalid-argument","Upgrade is invalid.");
      return u;
    });
  }
  return product;
}
function publicProduct(id,data) {
  return {id,name:data.name||"",brand:data.brand||"",category:data.category||"",desc:data.desc||"",inStock:data.inStock!==false,
    variants:(Array.isArray(data.variants)?data.variants:[]).map(v=>({id:v.id,color:v.color||"",processor:v.processor||"",ram:v.ram||"",rom:v.rom||"",price:v.price||0,promoPrice:v.promoPrice||0,image:v.image||"",deliveryFee:v.deliveryFee??null,deliveryRoute:v.deliveryRoute||"general",bulkSavingsEnabled:!!v.bulkSavingsEnabled,bulkSavingsMode:v.bulkSavingsMode||"general",bulkSavingsPercent:v.bulkSavingsPercent||0,bulkSavingsMinQty:v.bulkSavingsMinQty||0,inStock:v.inStock!==false})),
    upgrades:Array.isArray(data.upgrades)?data.upgrades.map(u=>({id:u.id||"",name:u.name||"",price:u.price||0})):[]};
}

export const manageLegacyProducts = onCall({region:"europe-west1",enforceAppCheck:true},async request=>{
  const data=request.data||{};
  if(!data || typeof data!=="object" || Array.isArray(data)) throw new HttpsError("invalid-argument","Request must be an object.");
  const action=data.action;
  if(action==="publicList"){
    if(Object.keys(data).some(k=>k!=="action")) throw new HttpsError("invalid-argument","Unsupported request fields.");
    const snap=await db.collection("products").limit(500).get();
    return snap.docs.map(d=>publicProduct(d.id,d.data())).filter(p=>p.inStock && p.variants.some(v=>v.inStock!==false));
  }
  const role=authorize(request);
  if(action==="list"){
    if(Object.keys(data).some(k=>k!=="action")) throw new HttpsError("invalid-argument","Unsupported request fields.");
    const snap=await db.collection("products").limit(500).get();
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }
  if(action==="create"){
    if(Object.keys(data).some(k=>!["action","product"].includes(k))) throw new HttpsError("invalid-argument","Unsupported request fields.");
    const product=validateProduct(data.product);
    const ref=await db.collection("products").add({...product,createdAt:FieldValue.serverTimestamp(),createdBy:request.auth.uid});
    await db.collection("auditLogs").add({action:"legacy_product_created",entityType:"legacy_product",entityId:ref.id,actorUid:request.auth.uid,actorRole:role,createdAt:FieldValue.serverTimestamp()});
    return {success:true,id:ref.id};
  }
  if(!["update","delete"].includes(action)||typeof data.id!=="string"||!ID.test(data.id)) throw new HttpsError("invalid-argument","Product ID or action is invalid.");
  const ref=db.collection("products").doc(data.id);
  if(action==="delete"){
    await ref.delete();
    await db.collection("auditLogs").add({action:"legacy_product_deleted",entityType:"legacy_product",entityId:data.id,actorUid:request.auth.uid,actorRole:role,createdAt:FieldValue.serverTimestamp()});
    return {success:true};
  }
  if(Object.keys(data).some(k=>!["action","id","product"].includes(k))) throw new HttpsError("invalid-argument","Unsupported request fields.");
  const product=validateProduct(data.product);
  await ref.update({...product,updatedAt:FieldValue.serverTimestamp(),updatedBy:request.auth.uid});
  await db.collection("auditLogs").add({action:"legacy_product_updated",entityType:"legacy_product",entityId:data.id,actorUid:request.auth.uid,actorRole:role,createdAt:FieldValue.serverTimestamp()});
  return {success:true,id:data.id};
});
