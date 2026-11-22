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
        if (old.productId !== input.productId || old.variantId !== input.variantId || old.quantity !== input.quantity || old.unitCost !== input.unitCost) fail("already-exists", "This submission key was already used for different purchase details.");
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
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !["purchaseId", "reason"].includes(k)) || typeof data.purchaseId !== "string" || !/^[a-f0-9]{64}$/.test(data.purchaseId)) fail("invalid-argument", "A valid purchase ID is required.");
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
