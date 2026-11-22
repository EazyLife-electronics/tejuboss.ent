import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const ROLE = {
  heroes: ["owner", "catalogue_manager"],
  reviews: ["owner", "catalogue_manager"],
  requests: ["owner", "order_manager"],
  settings: ["owner"]
};
const PUBLIC_SETTINGS = [
  "whatsapp", "tagline", "aboutText", "deliveryFeePerItem",
  "deliveryDiscountPercent", "minOrderValue", "bulkSavingsPercent",
  "bulkSavingsMinQty"
];
const HERO_FIELDS = ["title", "subtitle", "image", "ctaText", "linkType", "linkValue", "order"];
const REVIEW_FIELDS = ["name", "title", "stars", "text", "approved"];
const REQUEST_FIELDS = ["name", "phone", "need", "category", "budget"];

function requireRole(request, collectionName) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const role = request.auth.token.role;
  if (!ROLE[collectionName]?.includes(role)) {
    throw new HttpsError("permission-denied", "Your staff role cannot manage this section.");
  }
  return role;
}
function object(value, label = "data") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
}
function cleanFields(data, allowed, label) {
  object(data);
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.includes(key)) throw new HttpsError("invalid-argument", `Unsupported ${label} field: ${key}`);
    out[key] = value;
  }
  return out;
}
function boundedText(value, field, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return value.trim();
}
function validateContent(name, raw, action) {
  const fields = name === "heroes" ? HERO_FIELDS : name === "reviews" ? REVIEW_FIELDS : REQUEST_FIELDS;
  const data = cleanFields(raw, fields, name);
  if (name === "heroes") {
    if (action === "create" || "title" in data) data.title = boundedText(data.title, "title", 120, true);
    for (const field of ["subtitle", "ctaText", "linkValue"]) if (field in data) data[field] = boundedText(data[field], field, 500);
    if ("image" in data) {
      data.image = boundedText(data.image, "image", 2048, true);
      if (!/^https:\/\//i.test(data.image)) throw new HttpsError("invalid-argument", "Hero image must use HTTPS.");
    }
    if ("linkType" in data && !["category", "product", "url"].includes(data.linkType)) throw new HttpsError("invalid-argument", "Invalid hero link type.");
    if ("order" in data && (!Number.isInteger(data.order) || Math.abs(data.order) > 100000)) throw new HttpsError("invalid-argument", "Hero order is invalid.");
  }
  if (name === "reviews") {
    if ("name" in data) data.name = boundedText(data.name, "name", 100, true);
    if ("title" in data) data.title = boundedText(data.title, "title", 120);
    if ("text" in data) data.text = boundedText(data.text, "text", 1500, true);
    if ("stars" in data && (!Number.isInteger(data.stars) || data.stars < 1 || data.stars > 5)) throw new HttpsError("invalid-argument", "Stars must be from 1 to 5.");
    if ("approved" in data && typeof data.approved !== "boolean") throw new HttpsError("invalid-argument", "approved must be boolean.");
  }
  if (name === "requests") {
    if (action === "create") {
      data.name = boundedText(data.name, "name", 100, true);
      data.phone = boundedText(data.phone, "phone", 40, true);
      data.need = boundedText(data.need, "need", 1500, true);
      data.category = boundedText(data.category ?? "", "category", 100);
      if (data.budget !== undefined && data.budget !== "" && (!Number.isFinite(Number(data.budget)) || Number(data.budget) < 0 || Number(data.budget) > 1000000000)) throw new HttpsError("invalid-argument", "Budget is invalid.");
      data.status = "new";
      data.createdAt = FieldValue.serverTimestamp();
    } else if (Object.keys(data).some(k => k !== "status") || !["new", "contacted", "fulfilled"].includes(data.status)) {
      throw new HttpsError("invalid-argument", "Only a valid request status can be changed.");
    }
  }
  return data;
}

export const manageLegacyPublicContent = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    const data = request.data ?? {};
    object(data, "request");
    const { collection: name, action } = data;
    if (!["heroes", "reviews", "requests", "settings"].includes(name)) throw new HttpsError("invalid-argument", "Unsupported content collection.");
    const ref = db.collection(name);
    if (name === "settings") {
      if (action === "getPublic") {
        const snap = await db.doc("settings/site").get();
        const source = snap.exists ? snap.data() : {};
        return Object.fromEntries(PUBLIC_SETTINGS.filter(k => k in source).map(k => [k, source[k]]));
      }
      requireRole(request, name);
      if (action === "get") {
        const snap = await db.doc("settings/site").get();
        return snap.exists ? snap.data() : {};
      }
      if (action === "save") {
        const values = cleanFields(data.values, PUBLIC_SETTINGS, "settings");
        for (const key of ["deliveryFeePerItem", "minOrderValue", "bulkSavingsMinQty"]) {
          if (key in values && (!Number.isSafeInteger(values[key]) || values[key] < 0)) throw new HttpsError("invalid-argument", `${key} must be a non-negative integer.`);
        }
        for (const key of ["deliveryDiscountPercent", "bulkSavingsPercent"]) {
          if (key in values && (!Number.isFinite(values[key]) || values[key] < 0 || values[key] > 100)) throw new HttpsError("invalid-argument", `${key} must be between 0 and 100.`);
        }
        for (const key of ["whatsapp", "tagline", "aboutText"]) if (key in values) values[key] = boundedText(values[key], key, key === "aboutText" ? 5000 : 500);
        await db.doc("settings/site").set({ ...values, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid }, { merge: true });
        return { success: true };
      }
      throw new HttpsError("invalid-argument", "Unsupported settings action.");
    }

    if (name === "requests" && action === "create") {
      const clean = validateContent(name, data.values, action);
      const created = await ref.add(clean);
      return { id: created.id, success: true };
    }

    if (action === "list") {
      const publicOnly = data.publicOnly === true && ["heroes", "reviews"].includes(name);
      if (!publicOnly) requireRole(request, name);
      let query = ref;
      if (name === "reviews" && publicOnly) query = query.where("approved", "==", true);
      if (name === "heroes" && publicOnly) query = query.orderBy("order", "asc");
      const snap = await query.limit(100).get();
      if (publicOnly && name === "heroes") {
        return snap.docs.map(doc => {
          const d = doc.data();
          return { id: doc.id, title: d.title || "", subtitle: d.subtitle || "", image: d.image || "", ctaText: d.ctaText || "", linkType: d.linkType || "", linkValue: d.linkValue || "", order: d.order ?? 0 };
        });
      }
      if (publicOnly && name === "reviews") {
        return snap.docs.map(doc => {
          const d = doc.data();
          return { id: doc.id, name: d.name || "", title: d.title || "", stars: d.stars || 0, text: d.text || "", approved: true };
        });
      }
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
    requireRole(request, name);
    if (action === "create") {
      const clean = validateContent(name, data.values, action);
      const created = await ref.add({ ...clean, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid });
      return { id: created.id, success: true };
    }
    if (!["update", "delete"].includes(action) || typeof data.id !== "string" || !ID.test(data.id)) {
      throw new HttpsError("invalid-argument", "A valid document ID and action are required.");
    }
    const target = ref.doc(data.id);
    if (action === "delete") {
      if (name === "requests") throw new HttpsError("permission-denied", "Requests are retained for business records.");
      await target.delete();
      return { success: true };
    }
    const updates = validateContent(name, data.values, action);
    await target.update({ ...updates, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid });
    return { success: true };
  }
);
