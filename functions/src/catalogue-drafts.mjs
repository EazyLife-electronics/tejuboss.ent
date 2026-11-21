import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { validateCatalogueDraft } from "./domain/catalogue-draft.mjs";

const db = getFirestore();
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
  const ref = db.collection("catalogueDrafts").doc(draft.id);
  const audit = db.collection("auditLogs").doc();
  return db.runTransaction(async tx => {
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
  const snap = await db.collection("catalogueDrafts").orderBy("updatedAt", "desc").limit(100).get();
  return { drafts: snap.docs.map(doc => ({ id: doc.id, draft: doc.data().draft, version: doc.data().version || 0 })) };
});
