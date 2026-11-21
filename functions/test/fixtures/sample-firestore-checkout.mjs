/**
 * Firestore Emulator-only checkout harness.
 *
 * This intentionally lives under test/fixtures. It demonstrates atomic
 * Firestore transaction behaviour with synthetic records; it is NOT a
 * production checkout service or a production collection mapping.
 */
import { randomUUID } from "node:crypto";
import { calculateCheckoutQuote } from "../../src/domain/checkout-quote.mjs";
import { planLooseStockSale } from "../../src/domain/inventory-planning.mjs";
import {
  buildIdempotencyRecord,
  inspectIdempotencyReplay,
  createTrackingCredential
} from "../../src/domain/order-security.mjs";
import { validateCreateOrderRequest } from "../../src/domain/checkout.mjs";

const ROOT = "__checkoutEmulatorFixtures";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Test-only contract: one sample product, one variant, one piece-selling
 * option per request. Inventory uses loose-piece and sealed-carton balances.
 */
export async function commitSampleCheckout({
  db,
  fixtureId,
  scopeId,
  request,
  now = Date.now()
}) {
  if (!db || typeof fixtureId !== "string" || !fixtureId || typeof scopeId !== "string" || !scopeId) {
    throw new TypeError("db, fixtureId and server-derived scopeId are required");
  }
  const validated = validateCreateOrderRequest(request);
  if (validated.items.length !== 1 ||
      validated.items[0].productId !== "sample-led-bulb" ||
      validated.items[0].variantId !== "warm-white" ||
      validated.items[0].sellingOptionId !== "single-piece" ||
      !Number.isSafeInteger(validated.items[0].quantity)) {
    fail("INVALID_ARGUMENT", "Emulator harness accepts one whole-piece sample LED line only");
  }

  const root = db.collection(ROOT).doc(fixtureId);
  const productRef = root.collection("products").doc("sample-led-bulb");
  const looseRef = root.collection("inventory").doc("loose-pieces");
  const sealedRef = root.collection("inventory").doc("sealed-cartons");
  const policyRef = root.collection("settings").doc("delivery-policy");
  const candidate = buildIdempotencyRecord({
    scopeId,
    idempotencyKey: validated.idempotencyKey,
    payload: validated
  });
  const idempotencyRef = root.collection("idempotency").doc(candidate.keyHash);
  const orderRef = root.collection("orders").doc(randomUUID());
  const trackingCredential = createTrackingCredential();
  const trackingRef = root.collection("tracking").doc(trackingCredential.tokenHash);
  const breakMovementRef = root.collection("movements").doc(randomUUID());
  const saleMovementRef = root.collection("movements").doc(randomUUID());

  return db.runTransaction(async tx => {
    // Complete the read phase before any writes.
    const idempotencySnap = await tx.get(idempotencyRef);
    const productSnap = await tx.get(productRef);
    const looseSnap = await tx.get(looseRef);
    const sealedSnap = await tx.get(sealedRef);
    const policySnap = validated.fulfilment.method === "delivery"
      ? await tx.get(policyRef)
      : null;

    const replay = inspectIdempotencyReplay(idempotencySnap.exists ? idempotencySnap.data() : null, candidate);
    if (replay.outcome === "replay") {
      return { outcome: "replay", orderId: replay.orderId };
    }
    if (replay.outcome === "conflict") fail("ALREADY_EXISTS", "Idempotency key was reused with a different request");
    if (replay.outcome === "in_progress") fail("ABORTED", "Checkout is already processing");
    if (replay.outcome !== "new") {
      fail("FAILED_PRECONDITION", "Existing idempotency state requires explicit recovery handling");
    }

    if (!productSnap.exists || !looseSnap.exists || !sealedSnap.exists) {
      fail("FAILED_PRECONDITION", "Sample catalogue or inventory fixture is incomplete");
    }
    if (validated.fulfilment.method === "delivery" && !policySnap?.exists) {
      fail("FAILED_PRECONDITION", "Sample delivery policy is missing");
    }

    const productsById = new Map([[ "sample-led-bulb", productSnap.data() ]]);
    const deliveryPolicy = policySnap?.exists ? policySnap.data() : null;
    const quote = calculateCheckoutQuote({
      request: validated,
      productsById,
      deliveryPolicy
    });

    const loose = looseSnap.data();
    const sealed = sealedSnap.data();
    const stockPlan = planLooseStockSale({
      requestedUnits: quote.lines[0].stockUnitsConsumed,
      looseUnits: loose.quantityOnHand,
      sealedPackages: sealed.quantityOnHand,
      unitsPerSealedPackage: sealed.unitsPerPackage
    });
    if (!stockPlan.feasible) fail("FAILED_PRECONDITION", "Insufficient sample inventory");

    const createdAtMillis = now;
    const order = {
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
      createdAtMillis
    };
    const trackingProjection = {
      orderId: orderRef.id,
      status: "awaiting_confirmation",
      paymentStatus: "unpaid",
      fulfilmentStatus: "unfulfilled",
      createdAtMillis,
      updatedAtMillis: createdAtMillis
    };

    tx.create(orderRef, order);
    tx.create(trackingRef, trackingProjection);
    tx.create(idempotencyRef, {
      ...candidate,
      status: "completed",
      orderId: orderRef.id,
      createdAtMillis,
      completedAtMillis: createdAtMillis
    });
    tx.update(looseRef, { quantityOnHand: stockPlan.looseUnitsAfter, updatedAtMillis: createdAtMillis });
    tx.update(sealedRef, { quantityOnHand: stockPlan.sealedPackagesAfter, updatedAtMillis: createdAtMillis });

    let movementIndex = 0;
    if (stockPlan.packagesToOpen > 0) {
      tx.create(breakMovementRef, {
        type: "break_pack",
        orderId: orderRef.id,
        packagesOpened: stockPlan.packagesToOpen,
        unitsTransferred: stockPlan.transferredUnits,
        createdAtMillis
      });
      movementIndex++;
    }
    tx.create(saleMovementRef, {
      type: "sale",
      orderId: orderRef.id,
      unitsDeducted: stockPlan.requestedUnits,
      createdAtMillis
    });

    return {
      outcome: "created",
      orderId: orderRef.id,
      trackingToken: trackingCredential.rawToken,
      trackingTokenHash: trackingCredential.tokenHash,
      grandTotalMinor: quote.grandTotalMinor,
      stock: {
        looseUnitsAfter: stockPlan.looseUnitsAfter,
        sealedPackagesAfter: stockPlan.sealedPackagesAfter
      },
      movementCount: movementIndex + 1
    };
  });
}

export async function seedSampleCheckoutFixture(db, fixtureId, {
  looseUnits = 0,
  sealedCartons = 10,
  priceMinor = 150000
} = {}) {
  const root = db.collection(ROOT).doc(fixtureId);
  const batch = db.batch();
  batch.set(root.collection("products").doc("sample-led-bulb"), {
    published: true,
    variants: [{
      id: "warm-white",
      active: true,
      stockUnit: { code: "piece" },
      quantityPrecision: 0,
      sellingOptions: [{
        id: "single-piece",
        unitCode: "piece",
        displayName: "1 piece",
        stockUnitsPerSaleUnit: 1,
        minimumOrderQuantity: 1,
        orderQuantityStep: 1,
        active: true,
        priceMinor
      }]
    }]
  });
  batch.set(root.collection("inventory").doc("loose-pieces"), {
    quantityOnHand: looseUnits
  });
  batch.set(root.collection("inventory").doc("sealed-cartons"), {
    quantityOnHand: sealedCartons,
    unitsPerPackage: 48
  });
  batch.set(root.collection("settings").doc("delivery-policy"), {
    enabled: true,
    version: "fixture-v1",
    method: "flat_per_order",
    baseFeeMinor: 75000,
    zoneFeesMinor: { "ibadan-central": 25000 }
  });
  await batch.commit();
  return root;
}
