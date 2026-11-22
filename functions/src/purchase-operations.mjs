import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const KEY = /^[A-Za-z0-9_-]{16,100}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw new HttpsError(code, message); };
function authorize(request) {
  if (!request.auth) fail("unauthenticated", "Staff sign-in is required.");
  if (!["owner", "inventory_manager"].includes(request.auth.token.role)) {
    fail("permission-denied", "Inventory manager access is required.");
  }
}
function validateReceive(data) {
  const allowed = ["supplierName", "supplierId", "reference", "productId", "variantId", "quantity", "unitCost", "notes", "idempotencyKey"];
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) fail("invalid-argument", "Purchase request contains unsupported fields.");
  for (const key of ["productId", "variantId"]) if (typeof data[key] !== "string" || !ID.test(data[key])) fail("invalid-argument", key + " is invalid.");
  if (typeof data.supplierName !== "string" || !data.supplierName.trim() || data.supplierName.trim().length > 120) fail("invalid-argument", "Supplier name is required (maximum 120 characters).");
  if (data.supplierId !== undefined && (typeof data.supplierId !== "string" || !ID.test(data.supplierId))) fail("invalid-argument", "Supplier ID is invalid.");
  if (!Number.isSafeInteger(data.quantity) || data.quantity <= 0 || data.quantity > 100000000) fail("invalid-argument", "Quantity must be a positive whole number.");
  if (!Number.isSafeInteger(data.unitCost) || data.unitCost < 0 || data.unitCost > 100000000000) fail("invalid-argument", "Unit cost must be a non-negative whole naira amount.");
  for (const key of ["reference", "notes"]) if (data[key] !== undefined && (typeof data[key] !== "string" || data[key].length > (key === "reference" ? 120 : 500))) fail("invalid-argument", key + " is too long or invalid.");
  if (typeof data.idempotencyKey !== "string" || !KEY.test(data.idempotencyKey)) fail("invalid-argument", "A valid purchase submission key is required.");
  return { ...data, supplierName: data.supplierName.trim().replace(/\\s+/g, " "), reference: (data.reference || "").trim(), notes: (data.notes || "").trim() };
}
function variantLabel(variant, index) {
  const bits = [variant?.processor, variant?.ram, variant?.rom, variant?.color].filter(Boolean);
  return bits.length ? bits.join(" / ") : `Variant ${index + 1}`;
}
export const receiveLegacyPurchase = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  const input = validateReceive(request.data);
  const db = getFirestore();
  const purchaseId = hash(input.idempotencyKey);
  const purchaseRef = db.collection("purchases").doc(purchaseId);
  const productRef = db.collection("products").doc(input.productId);
  const movementRef = db.collection("inventoryMovements").doc();
  const auditRef = db.collection("auditLogs").doc();
  try {
    return await db.runTransaction(async tx => {
      const [existingPurchase, productSnap] = await Promise.all([tx.get(purchaseRef), tx.get(productRef)]);
      if (existingPurchase.exists) {
        const old = existingPurchase.data();
        if (old.status !== "received") fail("failed-precondition", "This purchase submission was previously voided and cannot be replayed.");
        if (old.productId !== input.productId || old.variantId !== input.variantId || old.quantity !== input.quantity || old.unitCost !== input.unitCost || String(old.supplier || "").toLowerCase() !== input.supplierName.toLowerCase()) fail("already-exists", "This submission key was already used for different purchase details.");
        return { success: true, outcome: "already_received", purchaseId };
      }
      if (!productSnap.exists) fail("not-found", "Product no longer exists.");
      const product = productSnap.data();
      const variants = Array.isArray(product.variants) ? [...product.variants] : [];
      const index = variants.findIndex(v => v?.id === input.variantId);
      if (index < 0) fail("failed-precondition", "Selected product variant no longer exists.");
      let supplierRef = input.supplierId ? db.collection("suppliers").doc(input.supplierId) : null;
      let supplierSnap = supplierRef ? await tx.get(supplierRef) : null;
      if (supplierSnap && !supplierSnap.exists) fail("not-found", "Selected supplier record no longer exists. Refresh and select it again.");
      if (!supplierRef) {
        const normalizedName = input.supplierName.toLowerCase();
        const matches = await tx.get(db.collection("suppliers").where("normalizedName", "==", normalizedName).limit(1));
        if (!matches.empty) {
          supplierSnap = matches.docs[0];
          supplierRef = supplierSnap.ref;
        } else {
          supplierRef = db.collection("suppliers").doc();
          supplierSnap = null;
        }
      }
      const supplier = supplierSnap?.data() || null;
      if (supplier && String(supplier.name || "").trim().toLowerCase() !== input.supplierName.toLowerCase()) fail("failed-precondition", "Supplier name does not match the selected Supplier Master record.");
      const supplierName = supplier?.name || input.supplierName;
      const current = Number(variants[index].stockQty || 0);
      if (!Number.isSafeInteger(current) || current < 0 || current + input.quantity > Number.MAX_SAFE_INTEGER) fail("failed-precondition", "Current product stock is invalid or exceeds the supported quantity.");
      const next = current + input.quantity;
      variants[index] = { ...variants[index], stockQty: next, inStock: true, costPrice: input.unitCost };
      tx.update(productRef, { variants, inStock: true });
      if (!supplierSnap) tx.create(supplierRef, {
        name: supplierName, normalizedName: supplierName.toLowerCase(),
        business: "", contactPerson: "", phone: "", whatsapp: "", email: "", address: "",
        notes: "Automatically created from a received purchase. Add contact details in Supplier Records.",
        source: "purchase", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid
      });
      const name = product.name || "";
      const sku = variants[index].sku || "";
      const label = variantLabel(variants[index], index);
      const totalCost = input.quantity * input.unitCost;
      if (!Number.isSafeInteger(totalCost)) fail("invalid-argument", "Purchase total exceeds the supported amount.");
      tx.create(purchaseRef, {
        supplier: supplierName, supplierId: supplierRef.id, reference: input.reference,
        productId: input.productId, variantId: input.variantId, productName: name,
        variantLabel: label, sku, quantity: input.quantity, unitCost: input.unitCost,
        totalCost, notes: input.notes, status: "received",
        createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid,
        schemaVersion: 2
      });
      tx.create(movementRef, {
        productId: input.productId, variantId: input.variantId, sku, productName: name,
        variantLabel: label, type: "purchase_received", quantity: input.quantity,
        previousQty: current, newQty: next, reason: "Purchase received",
        reference: input.reference || supplierName, purchaseId, supplier: supplierName,
        supplierId: supplierRef.id, unitCost: input.unitCost, totalCost,
        createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid
      });
      tx.create(auditRef, {
        action: "purchase_received", entityType: "purchase", entityId: purchaseId,
        productId: input.productId, variantId: input.variantId, quantity: input.quantity,
        quantityBefore: current, quantityAfter: next, supplierId: supplierRef.id,
        actorUid: request.auth.uid, actorRole: request.auth.token.role,
        createdAt: FieldValue.serverTimestamp()
      });
      return { success: true, outcome: "received", purchaseId, supplierId: supplierRef.id, quantityOnHand: next };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("receiveLegacyPurchase failed", error);
    throw new HttpsError("internal", "Purchase was not received. No stock change was committed.");
  }
});
export const voidLegacyPurchase = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  const data = request.data || {};
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !["purchaseId", "reason"].includes(k)) || typeof data.purchaseId !== "string" || !ID.test(data.purchaseId)) fail("invalid-argument", "A valid purchase ID is required.");
  if (data.reason !== undefined && (typeof data.reason !== "string" || data.reason.length > 240)) fail("invalid-argument", "Void reason must be 240 characters or fewer.");
  const reason = (data.reason || "Purchase correction").trim() || "Purchase voided";
  const db = getFirestore(), purchaseRef = db.collection("purchases").doc(data.purchaseId), auditRef = db.collection("auditLogs").doc(), movementRef = db.collection("inventoryMovements").doc();
  try {
    return await db.runTransaction(async tx => {
      const purchaseSnap = await tx.get(purchaseRef);
      if (!purchaseSnap.exists) fail("not-found", "Purchase record no longer exists.");
      const purchase = purchaseSnap.data();
      if (purchase.status === "voided") return { success: true, outcome: "already_voided" };
      if (purchase.status && purchase.status !== "received") fail("failed-precondition", "Only received purchases can be voided.");
      const qty = purchase.quantity;
      if (!Number.isSafeInteger(qty) || qty <= 0 || typeof purchase.productId !== "string" || typeof purchase.variantId !== "string") fail("failed-precondition", "Purchase record has invalid stock details.");
      const productRef = db.collection("products").doc(purchase.productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) fail("failed-precondition", "The product linked to this purchase no longer exists.");
      const product = productSnap.data(), variants = Array.isArray(product.variants) ? [...product.variants] : [];
      const index = variants.findIndex(v => v?.id === purchase.variantId);
      if (index < 0) fail("failed-precondition", "The variant linked to this purchase no longer exists.");
      const current = Number(variants[index].stockQty || 0);
      if (!Number.isSafeInteger(current) || current < qty) fail("failed-precondition", `Cannot void this purchase: only ${current} units remain, but this purchase added ${qty}. Stock has already been used or reduced.`);
      const next = current - qty;
      variants[index] = { ...variants[index], stockQty: next, inStock: next > 0 };
      tx.update(productRef, { variants, inStock: variants.some(v => Number(v.stockQty || 0) > 0) });
      tx.update(purchaseRef, { status: "voided", voidReason: reason, voidedAt: FieldValue.serverTimestamp(), voidedBy: request.auth.uid });
      tx.create(movementRef, {
        productId: purchase.productId, variantId: purchase.variantId, sku: purchase.sku || variants[index].sku || "",
        productName: purchase.productName || product.name || "", variantLabel: purchase.variantLabel || "",
        type: "purchase_void", quantity: -qty, previousQty: current, newQty: next,
        reason, reference: purchase.reference || purchase.supplier || "", purchaseId: data.purchaseId,
        reversalOf: "purchase_received", supplier: purchase.supplier || "", supplierId: purchase.supplierId || null,
        unitCost: Number(purchase.unitCost || 0), totalCost: Number(purchase.totalCost || 0),
        createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid
      });
      tx.create(auditRef, {
        action: "purchase_voided", entityType: "purchase", entityId: data.purchaseId,
        productId: purchase.productId, variantId: purchase.variantId, quantity: qty,
        quantityBefore: current, quantityAfter: next, reason,
        actorUid: request.auth.uid, actorRole: request.auth.token.role,
        createdAt: FieldValue.serverTimestamp()
      });
      return { success: true, outcome: "voided", quantityOnHand: next };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("voidLegacyPurchase failed", error);
    throw new HttpsError("internal", "Purchase was not voided. No stock change was committed.");
  }
});
export const listLegacyPurchases = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  if (request.data && Object.keys(request.data).length) fail("invalid-argument", "This request accepts no filters.");
  const db = getFirestore();
  try {
    const snap = await db.collection("purchases").orderBy("createdAt", "desc").limit(500).get();
    return { purchases: snap.docs.map(doc => {
      const p = doc.data();
      return { id: doc.id, supplier: p.supplier || "", supplierId: p.supplierId || "", reference: p.reference || "",
        productId: p.productId || "", variantId: p.variantId || "", productName: p.productName || "",
        variantLabel: p.variantLabel || "", sku: p.sku || "", quantity: Number.isSafeInteger(p.quantity) ? p.quantity : 0,
        unitCost: Number.isSafeInteger(p.unitCost) ? p.unitCost : 0, totalCost: Number.isSafeInteger(p.totalCost) ? p.totalCost : 0,
        notes: p.notes || "", status: p.status || "received", voidReason: p.voidReason || "",
        createdAtMillis: p.createdAt?.toMillis?.() || 0 };
    }), limited: snap.size === 500 };
  } catch (error) {
    console.error("listLegacyPurchases failed", error);
    throw new HttpsError("internal", "Could not load purchase history.");
  }
});

export const adjustLegacyVariantStock = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  const data = request.data || {};
  const allowed = ["productId", "variantId", "delta", "expectedQuantity", "reason", "reference", "idempotencyKey"];
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) fail("invalid-argument", "Stock adjustment contains unsupported fields.");
  for (const key of ["productId", "variantId"]) if (typeof data[key] !== "string" || !ID.test(data[key])) fail("invalid-argument", key + " is invalid.");
  if (!Number.isSafeInteger(data.delta) || data.delta === 0 || Math.abs(data.delta) > 100000000) fail("invalid-argument", "Stock change must be a non-zero whole number.");
  if (!Number.isSafeInteger(data.expectedQuantity) || data.expectedQuantity < 0) fail("invalid-argument", "Expected stock quantity is invalid.");
  if (typeof data.reason !== "string" || !data.reason.trim() || data.reason.length > 240) fail("invalid-argument", "A reason is required for every manual stock adjustment.");
  if (data.reference !== undefined && (typeof data.reference !== "string" || data.reference.length > 120)) fail("invalid-argument", "Reference is too long.");
  if (typeof data.idempotencyKey !== "string" || !KEY.test(data.idempotencyKey)) fail("invalid-argument", "A valid adjustment submission key is required.");
  const db = getFirestore(), movementId = hash("legacy-stock-adjustment:" + request.auth.uid + ":" + data.idempotencyKey);
  const movementRef = db.collection("inventoryMovements").doc(movementId);
  const productRef = db.collection("products").doc(data.productId), auditRef = db.collection("auditLogs").doc();
  try {
    return await db.runTransaction(async tx => {
      const [movementSnap, productSnap] = await Promise.all([tx.get(movementRef), tx.get(productRef)]);
      if (movementSnap.exists) return { success: true, outcome: "already_applied", movementId };
      if (!productSnap.exists) fail("not-found", "Product no longer exists.");
      const product = productSnap.data(), variants = Array.isArray(product.variants) ? [...product.variants] : [];
      const index = variants.findIndex(v => v?.id === data.variantId);
      if (index < 0) fail("failed-precondition", "Variant no longer exists.");
      const current = Number(variants[index].stockQty || 0);
      if (!Number.isSafeInteger(current) || current !== data.expectedQuantity) fail("aborted", "Stock changed since it was loaded. Refresh before adjusting.", { currentQuantity: current });
      const next = current + data.delta;
      if (!Number.isSafeInteger(next) || next < 0) fail("failed-precondition", "Stock cannot become negative or exceed the supported quantity.");
      variants[index] = { ...variants[index], stockQty: next, inStock: next > 0 };
      tx.update(productRef, { variants, inStock: variants.some(v => Number(v.stockQty || 0) > 0) });
      tx.create(movementRef, {
        productId: data.productId, variantId: data.variantId, sku: variants[index].sku || "",
        productName: product.name || "", variantLabel: variantLabel(variants[index], index),
        type: data.delta > 0 ? "stock_in" : "stock_out", quantity: data.delta,
        previousQty: current, newQty: next, reason: data.reason.trim(),
        reference: (data.reference || "").trim(), createdAt: FieldValue.serverTimestamp(),
        createdBy: request.auth.uid
      });
      tx.create(auditRef, {
        action: "legacy_variant_stock_adjusted", entityType: "product_variant",
        entityId: data.productId + ":" + data.variantId, quantityDelta: data.delta,
        quantityBefore: current, quantityAfter: next, reason: data.reason.trim(),
        actorUid: request.auth.uid, actorRole: request.auth.token.role,
        createdAt: FieldValue.serverTimestamp()
      });
      return { success: true, outcome: "adjusted", movementId, quantityOnHand: next };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("adjustLegacyVariantStock failed", error);
    throw new HttpsError("internal", "Stock adjustment was not saved.");
  }
});

function validateSupplier(data, updating = false) {
  const allowed = ["supplierId","name","business","contactPerson","phone","whatsapp","email","address","notes"];
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) fail("invalid-argument", "Supplier request contains unsupported fields.");
  if (updating && (typeof data.supplierId !== "string" || !ID.test(data.supplierId))) fail("invalid-argument", "Supplier ID is invalid.");
  const fields = {};
  for (const key of ["name","business","contactPerson","phone","whatsapp","email","address","notes"]) {
    const value = data[key] ?? "";
    if (typeof value !== "string" || value.length > (key === "notes" || key === "address" ? 1000 : 180)) fail("invalid-argument", key + " is invalid or too long.");
    fields[key] = value.trim();
  }
  fields.name = fields.name.replace(/\s+/g, " ");
  if (!fields.name) fail("invalid-argument", "Supplier name is required.");
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) fail("invalid-argument", "Supplier email is invalid.");
  fields.normalizedName = fields.name.toLowerCase();
  return fields;
}
export const listLegacySuppliers = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  if (request.data && Object.keys(request.data).length) fail("invalid-argument", "This request accepts no filters.");
  const db = getFirestore();
  try {
    const [suppliersSnap, purchasesSnap] = await Promise.all([
      db.collection("suppliers").orderBy("name").limit(500).get(),
      db.collection("purchases").orderBy("createdAt","desc").limit(1000).get()
    ]);
    return {
      suppliers: suppliersSnap.docs.map(d => ({ id:d.id, name:d.get("name")||"", normalizedName:d.get("normalizedName")||"", business:d.get("business")||"", contactPerson:d.get("contactPerson")||"", phone:d.get("phone")||"", whatsapp:d.get("whatsapp")||"", email:d.get("email")||"", address:d.get("address")||"", notes:d.get("notes")||"", source:d.get("source")||"legacy", createdAtMillis:d.get("createdAt")?.toMillis?.()||0, updatedAtMillis:d.get("updatedAt")?.toMillis?.()||0 })),
      purchases: purchasesSnap.docs.map(d => ({ id:d.id, supplier:d.get("supplier")||"", supplierId:d.get("supplierId")||"", quantity:Number.isSafeInteger(d.get("quantity"))?d.get("quantity"):0, totalCost:Number.isSafeInteger(d.get("totalCost"))?d.get("totalCost"):0, status:d.get("status")||"received", createdAtMillis:d.get("createdAt")?.toMillis?.()||0 })),
      truncated: suppliersSnap.size===500 || purchasesSnap.size===1000
    };
  } catch(e) { console.error("listLegacySuppliers failed",e); throw new HttpsError("internal","Could not load supplier records."); }
});
export const saveLegacySupplier = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  const input=validateSupplier(request.data, Boolean(request.data?.supplierId));
  const db=getFirestore(), ref=input.supplierId?db.collection("suppliers").doc(input.supplierId):db.collection("suppliers").doc(), auditRef=db.collection("auditLogs").doc();
  try {
    return await db.runTransaction(async tx=>{
      const existing=await tx.get(ref);
      if(input.supplierId&&!existing.exists) fail("not-found","Supplier record no longer exists.");
      const duplicate=await tx.get(db.collection("suppliers").where("normalizedName","==",input.normalizedName).limit(5));
      if(duplicate.docs.some(d=>d.id!==ref.id)) fail("already-exists","A supplier with this name already exists. Edit that record instead.");
      const now={updatedAt:FieldValue.serverTimestamp(),updatedBy:request.auth.uid};
      if(existing.exists) tx.update(ref,{...input,...now});
      else tx.create(ref,{...input,source:"manual",createdAt:FieldValue.serverTimestamp(),createdBy:request.auth.uid,...now});
      tx.create(auditRef,{action:existing.exists?"supplier_updated":"supplier_created",entityType:"supplier",entityId:ref.id,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
      return {success:true,supplierId:ref.id,created:!existing.exists};
    });
  } catch(e) { if(e instanceof HttpsError)throw e; console.error("saveLegacySupplier failed",e); throw new HttpsError("internal","Supplier record was not saved."); }
});
export const syncLegacyPurchaseSupplierLinks = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  if(request.data && Object.keys(request.data).length) fail("invalid-argument","This request accepts no filters.");
  const db=getFirestore();
  try {
    const snap=await db.collection("purchases").orderBy("createdAt","desc").limit(1000).get();
    let linked=0,created=0,skipped=0;
    for(const purchaseDoc of snap.docs){
      const p=purchaseDoc.data();
      if(p.status==="voided"||p.supplierId||typeof p.supplier!=="string"||!p.supplier.trim()){skipped++;continue;}
      const name=p.supplier.trim().replace(/\s+/g," "), normalizedName=name.toLowerCase();
      const result=await db.runTransaction(async tx=>{
        const fresh=await tx.get(purchaseDoc.ref);
        if(!fresh.exists||fresh.get("status")==="voided"||fresh.get("supplierId")) return {linked:false,created:false};
        const matches=await tx.get(db.collection("suppliers").where("normalizedName","==",normalizedName).limit(1));
        let supplierRef,wasCreated=false;
        if(!matches.empty) supplierRef=matches.docs[0].ref;
        else {
          supplierRef=db.collection("suppliers").doc();wasCreated=true;
          tx.create(supplierRef,{name,normalizedName,business:"",contactPerson:"",phone:"",whatsapp:"",email:"",address:"",notes:"Linked from legacy purchase history.",source:"purchase",createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),createdBy:request.auth.uid});
        }
        tx.update(purchaseDoc.ref,{supplier:supplierRef?name:name,supplierId:supplierRef.id,supplierSyncedAt:FieldValue.serverTimestamp()});
        return {linked:true,created:wasCreated};
      });
      if(result.linked){linked++;if(result.created)created++;}else skipped++;
    }
    return {success:true,linked,created,skipped,limited:snap.size===1000};
  } catch(e) { if(e instanceof HttpsError)throw e; console.error("syncLegacyPurchaseSupplierLinks failed",e); throw new HttpsError("internal","Supplier purchase links were not fully synchronized. Refresh and retry."); }
});
export const updateLegacyVariantMetadata = onCall({ region: "europe-west1", enforceAppCheck: true }, async request => {
  authorize(request);
  const d=request.data||{}, allowed=["productId","variantId","sku","reorderLevel","costPrice","expectedQuantity"];
  if(!d||typeof d!=="object"||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail("invalid-argument","Inventory settings contain unsupported fields.");
  for(const k of ["productId","variantId"])if(typeof d[k]!=="string"||!ID.test(d[k]))fail("invalid-argument",k+" is invalid.");
  if(typeof d.sku!=="string"||d.sku.length>60||!Number.isSafeInteger(d.reorderLevel)||d.reorderLevel<0||d.reorderLevel>100000000||!Number.isSafeInteger(d.costPrice)||d.costPrice<0||d.costPrice>100000000000||!Number.isSafeInteger(d.expectedQuantity)||d.expectedQuantity<0)fail("invalid-argument","SKU, reorder level, cost price or expected stock is invalid.");
  const db=getFirestore(),productRef=db.collection("products").doc(d.productId),auditRef=db.collection("auditLogs").doc();
  try{return await db.runTransaction(async tx=>{
    const snap=await tx.get(productRef);if(!snap.exists)fail("not-found","Product no longer exists.");
    const product=snap.data(),variants=Array.isArray(product.variants)?[...product.variants]:[],i=variants.findIndex(v=>v?.id===d.variantId);
    if(i<0)fail("failed-precondition","Variant no longer exists.");
    const current=Number(variants[i].stockQty||0);if(current!==d.expectedQuantity)fail("aborted","Stock changed while editing. Refresh and try again.");
    variants[i]={...variants[i],sku:d.sku.trim(),reorderLevel:d.reorderLevel,costPrice:d.costPrice,stockQty:current,inStock:current>0};
    tx.update(productRef,{variants,inStock:variants.some(v=>Number(v.stockQty||0)>0)});
    tx.create(auditRef,{action:"legacy_variant_metadata_updated",entityType:"product_variant",entityId:d.productId+":"+d.variantId,sku:d.sku.trim(),reorderLevel:d.reorderLevel,costPrice:d.costPrice,actorUid:request.auth.uid,actorRole:request.auth.token.role,createdAt:FieldValue.serverTimestamp()});
    return {success:true};
  });}catch(e){if(e instanceof HttpsError)throw e;console.error("updateLegacyVariantMetadata failed",e);throw new HttpsError("internal","Inventory settings were not saved.");}
});
