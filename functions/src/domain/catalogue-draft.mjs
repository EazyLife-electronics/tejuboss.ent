/**
 * Validation boundary for the new structured catalogue editor.
 * Drafts are intentionally independent of the legacy product document.
 */
import { validateCheckoutProduct } from "./catalogue.mjs";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateCatalogueDraft(draft) {
  const issues = [];
  if (!record(draft)) return { valid: false, issues: [{ path: "$", message: "Draft must be an object" }] };
  for (const field of ["name", "category"]) {
    if (typeof draft[field] !== "string" || !draft[field].trim()) {
      issues.push({ path: field, message: "Required product information is missing" });
    }
  }
  if (draft.brand !== undefined && typeof draft.brand !== "string") {
    issues.push({ path: "brand", message: "Brand must be text" });
  }
  if (draft.description !== undefined && typeof draft.description !== "string") {
    issues.push({ path: "description", message: "Description must be text" });
  }
  if (typeof draft.published !== "boolean") {
    issues.push({ path: "published", message: "Publication state must be explicit" });
  }
  if (!Array.isArray(draft.variants) || draft.variants.length === 0) {
    issues.push({ path: "variants", message: "Add at least one variant" });
  } else {
    const checkoutShape = { ...draft, published: true, variants: draft.variants.map(variant => ({ ...variant, active: true, sellingOptions: Array.isArray(variant.sellingOptions) ? variant.sellingOptions.map(option => ({ ...option, active: true })) : variant.sellingOptions })) };
    const result = validateCheckoutProduct(checkoutShape);
    issues.push(...result.issues);
  }
  return { valid: issues.length === 0, issues };
}

/** Convert a user-entered Naira amount to integer kobo without floating drift. */
export function nairaToKobo(value, field = "price") {
  const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`${field} must be a non-negative Naira amount`);
  }
  const kobo = Math.round(amount * 100);
  if (!Number.isSafeInteger(kobo) || Math.abs(amount * 100 - kobo) > 1e-7) {
    throw new RangeError(`${field} supports a maximum of two decimal places`);
  }
  return kobo;
}

/** Create IDs once; callers must retain them when editing the same records. */
export function createCatalogueId(prefix = "item") {
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9_-]{0,15}$/.test(prefix)) {
    throw new TypeError("ID prefix is invalid");
  }
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure UUID generation is unavailable");
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}
