import { randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { validateCreateOrderRequest } from "./domain/checkout.mjs";
import { calculateCheckoutQuote } from "./domain/checkout-quote.mjs";
import { hashGuestSessionCredential, isGuestSessionRecordValid } from "./domain/guest-session.mjs";
import { buildIdempotencyRecord, inspectIdempotencyReplay, createTrackingCredential } from "./domain/order-security.mjs";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
function fail(code, message, details) { throw new HttpsError(code, message, details); }
function sessionToken(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !["sessionToken", "order"].includes(key))) {
    fail("invalid-argument", "Request must contain sessionToken and order only.");
  }
  if (typeof data.sessionToken !== "string") fail("unauthenticated", "Guest checkout session is required.");
  return data.sessionToken;
}
function toTierRules(configSnap, productId, variantId) {
  if (!configSnap?.exists) return [];
  const config = configSnap.data();
  const rules = config.rules && typeof config.rules === "object" ? config.rules : {};
  return Object.values(rules).filter(rule => rule && rule.enabled === true).map(rule => ({
    productId, variantId, rule
  }));
}
function mapDeductions(validated, productsById, mappingSnaps) {
  const byBalance = new Map();
  for (let i = 0; i < validated.items.length; i++) {
    const item = validated.items[i];
    const product = productsById.get(item.productId);
    const variant = product?.variants?.find(v => v.id === item.variantId && v.active === true);
    const option = variant?.sellingOptions?.find(o => o.id === item.sellingOptionId && o.active === true);
    const mappingSnap = mappingSnaps[i];
    if (!mappingSnap?.exists) fail("failed-precondition", "Inventory mapping is not configured for one or more selected items.");
    const mapping = mappingSnap.data();
    if (!option || !Number.isSafeInteger(option.stockUnitsPerSaleUnit) ||
        !Number.isSafeInteger(mapping.stockUnitsPerSaleUnit) ||
        mapping.stockUnitsPerSaleUnit !== option.stockUnitsPerSaleUnit ||
        typeof mapping.balanceId !== "string" || !ID.test(mapping.balanceId) ||
        !["productId", "variantId", "locationId", "inventoryFormId", "stockUnitCode"].every(k => typeof mapping[k] === "string" && ID.test(mapping[k])) ||
        mapping.productId !== item.productId || mapping.variantId !== item.variantId ||
        mapping.sellingOptionId !== item.sellingOptionId) {
      fail("failed-precondition", "Inventory mapping does not match the current published selling option.");
    }
    const stockUnits = item.quantity * mapping.stockUnitsPerSaleUnit;
    if (!Number.isSafeInteger(stockUnits) || stockUnits <= 0) {
      fail("failed-precondition", "This selling quantity cannot be represented in the configured stock unit.");
    }
    const prior = byBalance.get(mapping.balanceId);
    if (prior) {
      if (prior.productId !== mapping.productId || prior.variantId !== mapping.variantId ||
          prior.locationId !== mapping.locationId || prior.inventoryFormId !== mapping.inventoryFormId ||
          prior.stockUnitCode !== mapping.stockUnitCode ||
          prior.stockUnitsPerBalanceUnit !== mapping.stockUnitsPerBalanceUnit ||
          prior.sealedBalanceId !== (mapping.sealedBalanceId ?? null) ||
          prior.unitsPerPackage !== (mapping.unitsPerPackage ?? null)) {
        fail("failed-precondition", "Conflicting inventory mappings share a balance.");
      }
      prior.stockUnits += stockUnits;
      if (!Number.isSafeInteger(prior.stockUnits)) fail("failed-precondition", "Combined stock quantity exceeds supported range.");
    } else {
      byBalance.set(mapping.balanceId, {
        balanceId: mapping.balanceId,
        productId: mapping.productId,
        variantId: mapping.variantId,
        locationId: mapping.locationId,
        inventoryFormId: mapping.inventoryFormId,
        stockUnitCode: mapping.stockUnitCode,
        stockUnitsPerBalanceUnit: mapping.stockUnitsPerBalanceUnit,
        sealedBalanceId: mapping.sealedBalanceId ?? null,
        unitsPerPackage: mapping.unitsPerPackage ?? null,
        stockUnits
      });
    }
  }
  return [...byBalance.values()];
}

/**
 * Trusted guest order creation.
 * Order submission is stock-neutral. Stock deductions are snapshotted from
 * server-managed inventory mappings and applied only by staff confirmation.
 */
export const createGuestOrder = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (request.auth) fail("invalid-argument", "This endpoint is for guest checkout.");
    const rawSessionToken = sessionToken(request.data);
    let validated;
    try { validated = validateCreateOrderRequest(request.data.order); }
    catch (error) {
      if (error?.code === "INVALID_ARGUMENT") fail("invalid-argument", error.message, error.details);
      throw error;
    }
    let sessionHash;
    try { sessionHash = hashGuestSessionCredential(rawSessionToken); }
    catch { fail("unauthenticated", "Guest checkout session is invalid or expired."); }

    const firestore = getFirestore();
    const sessionRef = firestore.collection("guestSessions").doc(sessionHash);
    const candidate = buildIdempotencyRecord({
      scopeId: sessionHash,
      idempotencyKey: validated.idempotencyKey,
      payload: validated
    });
    const idempotencyRef = firestore.collection("checkoutIdempotency").doc(candidate.keyHash);
    const now = Date.now();

    try {
      return await firestore.runTransaction(async tx => {
        const sessionSnap = await tx.get(sessionRef);
        if (!sessionSnap.exists || !isGuestSessionRecordValid({
          rawToken: rawSessionToken, record: sessionSnap.data(), now
        })) {
          fail("unauthenticated", "Guest checkout session is invalid or expired.");
        }
        const replaySnap = await tx.get(idempotencyRef);
        const replay = inspectIdempotencyReplay(replaySnap.exists ? replaySnap.data() : null, candidate);
        if (replay.outcome === "replay") {
          return { success: true, outcome: "replay", orderId: replay.orderId };
        }
        if (replay.outcome === "conflict") fail("already-exists", "Idempotency key was reused with different order details.");
        if (replay.outcome === "in_progress") fail("aborted", "This order request is already processing.");
        if (replay.outcome !== "new") fail("failed-precondition", "Checkout retry requires staff recovery.");

        const productIds = [...new Set(validated.items.map(item => item.productId))];
        const variantPairs = [...new Map(validated.items.map(item => [JSON.stringify([item.productId, item.variantId]), { productId: item.productId, variantId: item.variantId }])).values()];
        const mappingIds = validated.items.map(item => item.productId + "__" + item.variantId + "__" + item.sellingOptionId);
        const productRefs = productIds.map(id => firestore.collection("catalogueProducts").doc(id));
        const pricingRefs = variantPairs.map(pair => firestore.collection("pricingConfigs").doc(pair.productId + "__" + pair.variantId));
        const mappingRefs = mappingIds.map(id => firestore.collection("inventoryMappings").doc(id));
        const deliveryRef = firestore.collection("deliveryPolicies").doc("active");
        const [productSnaps, pricingSnaps, mappingSnaps, deliverySnap] = await Promise.all([
          Promise.all(productRefs.map(ref => tx.get(ref))),
          Promise.all(pricingRefs.map(ref => tx.get(ref))),
          Promise.all(mappingRefs.map(ref => tx.get(ref))),
          validated.fulfilment.method === "delivery" ? tx.get(deliveryRef) : Promise.resolve(null)
        ]);

        const productsById = new Map();
        productIds.forEach((id, index) => {
          const snap = productSnaps[index];
          if (!snap.exists || snap.data().published !== true) fail("failed-precondition", "A selected product is not currently published.");
          productsById.set(id, snap.data());
        });
        const tierRules = [];
        variantPairs.forEach((pair, index) => {
          tierRules.push(...toTierRules(pricingSnaps[index], pair.productId, pair.variantId));
        });
        const deliveryPolicy = deliverySnap?.exists ? deliverySnap.data() : null;
        if (validated.fulfilment.method === "delivery" && !deliveryPolicy) {
          fail("failed-precondition", "Delivery is not configured for checkout yet.");
        }
        const quote = calculateCheckoutQuote({
          request: validated, productsById, deliveryPolicy, quantityTierRules: tierRules
        });
        const inventoryDeductions = mapDeductions(validated, productsById, mappingSnaps);
        const orderRef = firestore.collection("orders").doc(randomUUID());
        const trackingCredential = createTrackingCredential();
        const trackingRef = firestore.collection("orderTracking").doc(trackingCredential.tokenHash);
        const auditRef = firestore.collection("auditLogs").doc();

        const order = {
          schemaVersion: 1,
          orderId: orderRef.id,
          source: "guest",
          status: "awaiting_confirmation",
          paymentStatus: "unpaid",
          fulfilmentStatus: "unfulfilled",
          customer: quote.customer,
          fulfilment: quote.fulfilment,
          note: quote.note,
          currency: quote.currency,
          lines: quote.lines,
          subtotalMinor: quote.subtotalMinor,
          discountMinor: quote.discountMinor,
          deliveryFeeMinor: quote.deliveryFeeMinor,
          grandTotalMinor: quote.grandTotalMinor,
          deliveryPolicyVersion: quote.delivery?.policyVersion ?? null,
          appliedTierRules: quote.appliedTierRules ?? [],
          pricingConfigVersion: pricingSnaps.map(s => s.exists ? s.data().version : 0),
          inventoryDeductions,
          trackingTokenHash: trackingCredential.tokenHash,
          createdAtMillis: now,
          updatedAtMillis: now
        };
        tx.create(orderRef, order);
        tx.create(trackingRef, {
          orderId: orderRef.id,
          status: "awaiting_confirmation",
          paymentStatus: "unpaid",
          fulfilmentStatus: "unfulfilled",
          createdAtMillis: now,
          updatedAtMillis: now
        });
        tx.create(idempotencyRef, {
          ...candidate,
          status: "completed",
          orderId: orderRef.id,
          createdAtMillis: now,
          completedAtMillis: now
        });
        tx.create(auditRef, {
          action: "guest_order_created",
          entityType: "order",
          entityId: orderRef.id,
          createdAt: FieldValue.serverTimestamp(),
          source: "guest_checkout"
        });
        return {
          success: true,
          outcome: "created",
          orderId: orderRef.id,
          trackingToken: trackingCredential.rawToken,
          status: "awaiting_confirmation",
          currency: quote.currency,
          subtotalMinor: quote.subtotalMinor,
          discountMinor: quote.discountMinor,
          deliveryFeeMinor: quote.deliveryFeeMinor,
          grandTotalMinor: quote.grandTotalMinor
        };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (["PRODUCT_UNAVAILABLE", "CATALOGUE_NOT_READY", "MINIMUM_ORDER_QUANTITY", "INVALID_ORDER_QUANTITY_STEP", "DELIVERY_POLICY_UNAVAILABLE", "DELIVERY_AREA_UNSUPPORTED", "DELIVERY_AREA_REQUIRED", "DELIVERY_METHOD_NOT_SUPPORTED"].includes(error?.code)) {
        throw new HttpsError("failed-precondition", error.message);
      }
      console.error("createGuestOrder failed", error);
      throw new HttpsError("internal", "Could not create this order. No stock was deducted.");
    }
  }
);
