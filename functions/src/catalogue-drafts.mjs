import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { validateCatalogueDraft } from "./domain/catalogue-draft.mjs";

const db = () => getFirestore();
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

function authorize(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Admin sign-in is required.");
  const role = request.auth.token.role;
  if (role !== "owner" && role !== "catalogue_manager") {
    throw new HttpsError("permission-denied", "Catalogue manager access is required.");
  }
}
function validateDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new HttpsError("invalid-argument", "Draft must be an object.");
  }
  const allowed = ["id", "name", "brand", "category", "description", "published", "variants"];
  if (Object.keys(draft).some(key => !allowed.includes(key))) {
    throw new HttpsError("invalid-argument", "Draft contains unsupported fields.");
  }
  if (typeof draft.id !== "string" || !ID.test(draft.id)) {
    throw new HttpsError("invalid-argument", "Draft ID is invalid.");
  }
  const result = validateCatalogueDraft(draft);
  if (!result.valid) {
    throw new HttpsError("invalid-argument", "Draft validation failed.", { issues: result.issues });
  }
  return draft;
}

export const saveCatalogueDraft = onCall({ region: "europe-west1" }, async request => {
  authorize(request);
  const data = request.data || {};
  if (Object.keys(data).some(key => !["draft", "expectedVersion"].includes(key))) {
    throw new HttpsError("invalid-argument", "Unsupported request fields.");
  }
  const draft = validateDraft(data.draft);
  if (data.expectedVersion !== undefined &&
      (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0)) {
    throw new HttpsError("invalid-argument", "Expected version is invalid.");
  }
  const ref = db().collection("catalogueDrafts").doc(draft.id);
  const audit = db().collection("auditLogs").doc();
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const version = snap.exists && Number.isSafeInteger(snap.data().version) ? snap.data().version : 0;
    if (data.expectedVersion !== undefined && data.expectedVersion !== version) {
      throw new HttpsError("aborted", "Draft changed elsewhere. Reload before saving.", { currentVersion: version });
    }
    const next = version + 1;
    tx.set(ref, { schemaVersion: 1, draft, version: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid });
    tx.set(audit, { action: "catalogue_draft_saved", entityType: "catalogue_draft", entityId: draft.id, version: next, actorUid: request.auth.uid, actorRole: request.auth.token.role, createdAt: FieldValue.serverTimestamp() });
    return { success: true, draftId: draft.id, version: next };
  });
});

export const listCatalogueDrafts = onCall({ region: "europe-west1" }, async request => {
  authorize(request);
  if (request.data && Object.keys(request.data).length) {
    throw new HttpsError("invalid-argument", "This endpoint accepts no input.");
  }
  const snap = await db().collection("catalogueDrafts").orderBy("updatedAt", "desc").limit(100).get();
  return { drafts: snap.docs.map(doc => ({ id: doc.id, draft: doc.data().draft, version: doc.data().version || 0 })) };
});

import { buildPublishedCatalogueProduct } from "./domain/catalogue-publication.mjs";

/**
 * Explicit publication step. This never initializes or changes inventory.
 * The separate collection keeps legacy storefront documents untouched.
 */
export const publishCatalogueDraft = onCall({ region: "europe-west1" }, async request => {
  authorize(request);
  const data = request.data || {};
  if (Object.keys(data).some(key => !["draftId", "expectedVersion"].includes(key))) {
    throw new HttpsError("invalid-argument", "Unsupported publication request fields.");
  }
  if (typeof data.draftId !== "string" || !ID.test(data.draftId)) {
    throw new HttpsError("invalid-argument", "A valid draftId is required.");
  }
  if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 1) {
    throw new HttpsError("invalid-argument", "The current draft version is required.");
  }

  const draftRef = db().collection("catalogueDrafts").doc(data.draftId);
  const productRef = db().collection("catalogueProducts").doc(data.draftId);
  const auditRef = db().collection("auditLogs").doc();

  try {
    return await db().runTransaction(async tx => {
      const [draftSnap, productSnap] = await Promise.all([
        tx.get(draftRef),
        tx.get(productRef)
      ]);
      if (!draftSnap.exists) {
        throw new HttpsError("not-found", "Catalogue draft was not found.");
      }
      const stored = draftSnap.data();
      if (stored.version !== data.expectedVersion) {
        throw new HttpsError("aborted", "Draft changed since it was loaded. Reload before publishing.", {
          currentVersion: stored.version || 0
        });
      }
      const draft = validateDraft(stored.draft);
      if (draft.id !== data.draftId) {
        throw new HttpsError("failed-precondition", "Draft identity does not match its storage record.");
      }
      let publicProduct;
      try {
        publicProduct = buildPublishedCatalogueProduct(draft);
      } catch (error) {
        throw new HttpsError("failed-precondition", error.message, { issues: error.details || [] });
      }

      const currentProduct = productSnap.exists ? productSnap.data() : null;
      if (currentProduct && (
        currentProduct.catalogueSchemaVersion !== 2 ||
        currentProduct.sourceDraftId !== data.draftId
      )) {
        throw new HttpsError("already-exists", "A product already uses this ID. The existing catalogue record was not changed.");
      }
      const publicationVersion = Number.isSafeInteger(currentProduct?.publicationVersion)
        ? currentProduct.publicationVersion + 1 : 1;
      const now = FieldValue.serverTimestamp();
      tx.set(productRef, {
        ...publicProduct,
        publicationVersion,
        createdAt: currentProduct?.createdAt || now,
        updatedAt: now,
        publishedAt: now,
        publishedBy: request.auth.uid
      });
      tx.set(auditRef, {
        action: "catalogue_product_published",
        entityType: "product",
        entityId: data.draftId,
        sourceDraftId: data.draftId,
        draftVersion: stored.version,
        publicationVersion,
        actorUid: request.auth.uid,
        actorRole: request.auth.token.role,
        createdAt: now
      });
      return {
        success: true,
        productId: data.draftId,
        draftVersion: stored.version,
        publicationVersion,
        published: true,
        inventoryChanged: false
      };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("publishCatalogueDraft failed", error);
    throw new HttpsError("internal", "Could not publish catalogue product. No changes were committed.");
  }
});
