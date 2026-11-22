import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { buildPublicQuantityTierProjection } from "./domain/public-quantity-pricing.mjs";
import { validateQuantityTierRule } from "./domain/quantity-tier-engine.mjs";
import { validatePricingPublicationTarget } from "./domain/pricing-publication-target.mjs";

initializeApp();
const db = getFirestore();

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const RULE_FIELDS = new Set([
  "id", "enabled", "qualificationBasis", "aggregateAcrossOptions",
  "eligibleSellingOptionIds", "pricingMode", "tiers",
  "effectiveFromMillis", "effectiveUntilMillis"
]);
const TIER_FIELDS = new Set([
  "id", "minimumQuantity", "maximumQuantity",
  "pricePerBaseUnitMinor", "priceBySellingOptionId"
]);

function assertOnlyKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", `Unsupported ${label} field: ${unexpected[0]}.`);
  }
}

function validatePublicationPayload(data) {
  assertOnlyKeys(data, new Set([
    "productId", "variantId", "rule", "expectedVersion"
  ]), "request");
  for (const field of ["productId", "variantId"]) {
    if (typeof data[field] !== "string" || !ID_PATTERN.test(data[field])) {
      throw new HttpsError("invalid-argument", `${field} is invalid.`);
    }
  }
  if (data.expectedVersion !== undefined &&
      (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0)) {
    throw new HttpsError("invalid-argument", "expectedVersion must be a non-negative integer.");
  }
  assertOnlyKeys(data.rule, RULE_FIELDS, "rule");
  if (!Array.isArray(data.rule.tiers)) {
    throw new HttpsError("invalid-argument", "rule.tiers must be an array.");
  }
  data.rule.tiers.forEach((tier, index) => assertOnlyKeys(tier, TIER_FIELDS, `tiers[${index}]`));
  const validation = validateQuantityTierRule(data.rule);
  if (!validation.valid) {
    throw new HttpsError("invalid-argument", "Quantity-tier configuration is invalid.", {
      issues: validation.issues
    });
  }
  return data;
}

/**
 * Owner/pricing-manager only. Writes the private source of truth, public-safe
 * projection and audit record atomically. This does not deploy Firestore rules.
 */
export const publishQuantityPricing = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async request => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in with an authorized admin account.");
    }
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "pricing_manager") {
      throw new HttpsError("permission-denied", "Pricing manager access is required.");
    }

    const payload = validatePublicationPayload(request.data ?? {});
    const { productId, variantId } = payload;
    const ruleId = payload.rule.id;
    if (typeof ruleId !== "string" || !ID_PATTERN.test(ruleId)) {
      throw new HttpsError("invalid-argument", "rule.id is invalid.");
    }

    const configId = `${productId}__${variantId}`;
    const publicPricingId = `${productId}__${variantId}__${ruleId}`;
    const configRef = db.collection("pricingConfigs").doc(configId);
    // Quantity offers target the new structured catalogue, not legacy products.
    const productRef = db.collection("catalogueProducts").doc(productId);
    const publicRef = db.collection("publicPricing").doc(publicPricingId);
    const auditRef = db.collection("auditLogs").doc();

    try {
      return await db.runTransaction(async tx => {
        const [productSnap, configSnap] = await Promise.all([
          tx.get(productRef),
          tx.get(configRef)
        ]);
        if (payload.rule.enabled === true) {
          const target = validatePricingPublicationTarget({
            product: productSnap.exists ? productSnap.data() : null,
            variantId,
            rule: payload.rule
          });
          if (!target.valid) {
            throw new HttpsError(
              "failed-precondition",
              "This offer cannot be activated until its product, variant and selling options are migrated and active.",
              { issues: target.issues }
            );
          }
        }

        const current = configSnap.exists ? configSnap.data() : null;
        const currentVersion = Number.isSafeInteger(current?.version) ? current.version : 0;
        if (payload.expectedVersion !== undefined &&
            payload.expectedVersion !== currentVersion) {
          throw new HttpsError("aborted", "Pricing changed since it was loaded. Refresh before saving.", {
            currentVersion
          });
        }

        const nowMillis = Date.now();
        const nextVersion = currentVersion + 1;
        const privateConfig = {
          schemaVersion: 1,
          productId,
          variantId,
          version: nextVersion,
          rules: {
            ...(current?.rules && typeof current.rules === "object" ? current.rules : {}),
            [ruleId]: {
              ...payload.rule,
              updatedAtMillis: nowMillis,
              updatedBy: request.auth.uid
            }
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: request.auth.uid
        };
        const projection = buildPublicQuantityTierProjection({
          productId,
          variantId,
          rule: payload.rule,
          configVersion: `v${nextVersion}`,
          nowMillis
        });

        tx.set(configRef, privateConfig, { merge: false });
        tx.set(publicRef, projection, { merge: false });
        tx.set(auditRef, {
          action: "quantity_pricing_published",
          entityType: "quantity_pricing",
          entityId: publicPricingId,
          productId,
          variantId,
          ruleId,
          configVersion: nextVersion,
          publicationState: projection.publicationState,
          actorUid: request.auth.uid,
          actorRole: role,
          createdAt: FieldValue.serverTimestamp()
        });

        return {
          success: true,
          productId,
          variantId,
          ruleId,
          configVersion: nextVersion,
          publicationState: projection.publicationState,
          enabled: projection.enabled
        };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("publishQuantityPricing failed", error);
      throw new HttpsError("internal", "Could not publish quantity pricing. No changes were committed.");
    }
  }
);

/**
 * Retrieve private tier configuration for the authenticated pricing editor.
 * Private pricing is never exposed through direct client Firestore reads.
 */
export const getQuantityPricingConfig = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async request => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in with an authorized admin account.");
    }
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "pricing_manager") {
      throw new HttpsError("permission-denied", "Pricing manager access is required.");
    }
    const data = request.data ?? {};
    assertOnlyKeys(data, new Set(["productId", "variantId"]), "request");
    if (typeof data.productId !== "string" || !ID_PATTERN.test(data.productId) ||
        typeof data.variantId !== "string" || !ID_PATTERN.test(data.variantId)) {
      throw new HttpsError("invalid-argument", "A valid productId and variantId are required.");
    }
    const configId = `${data.productId}__${data.variantId}`;
    const snap = await db.collection("pricingConfigs").doc(configId).get();
    if (!snap.exists) {
      return { productId: data.productId, variantId: data.variantId, version: 0, rules: {} };
    }
    const config = snap.data();
    return {
      productId: data.productId,
      variantId: data.variantId,
      version: Number.isSafeInteger(config.version) ? config.version : 0,
      rules: config.rules && typeof config.rules === "object" ? config.rules : {}
    };
  }
);

/**
 * Deployment and emulator smoke-test endpoint.
 * This endpoint deliberately exposes no customer, catalogue, pricing or stock data.
 */
export const backendStatus = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async request => {
    if (request.data && Object.keys(request.data).length > 0) {
      throw new HttpsError("invalid-argument", "This endpoint accepts no input.");
    }
    return {
      service: "tejuboss-commerce",
      status: "ready",
      version: 1,
      projectId: process.env.GCLOUD_PROJECT || null,
      timestamp: new Date().toISOString()
    };
  }
);

export { saveCatalogueDraft, listCatalogueDrafts, publishCatalogueDraft } from "./catalogue-drafts.mjs";

export { createGuestCheckoutSession } from "./guest-checkout-session.mjs";

export { decideOrder } from "./order-confirmation.mjs";

export { createGuestOrder } from "./guest-order.mjs";

export { initializeInventoryBalance } from "./inventory-setup.mjs";

export { saveInventoryMapping } from "./inventory-mapping.mjs";

export { listInventorySetup } from "./inventory-overview.mjs";

export { adjustInventoryPhysicalCount } from "./inventory-adjustment.mjs";

export { getDeliveryPolicy, saveDeliveryPolicy } from "./delivery-policy-admin.mjs";
export { listPendingCommerceOrders } from "./order-queue.mjs";

export { getGuestOrderTracking, recoverGuestOrderTracking } from "./order-tracking.mjs";

export { getPublicDeliveryOptions } from "./delivery-public.mjs";

export { updateOrderFulfilment } from "./order-fulfilment.mjs";

export { recordOrderPayment } from "./order-payment.mjs";
