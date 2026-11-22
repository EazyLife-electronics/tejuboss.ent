/**
 * Firestore Emulator-only confirmation adapter.
 * Synthetic fixture only; never imported by production Functions.
 * Inventory is deducted atomically when staff confirms an order.
 */
import { randomUUID } from "node:crypto";
import { planLooseStockSale } from "../../src/domain/inventory-planning.mjs";
import { planOrderDecision } from "../../src/domain/order-lifecycle.mjs";

const ROOT = "__checkoutEmulatorFixtures";
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

export async function decideSampleOrder({ db, fixtureId, orderId, decision, now = Date.now() }) {
  const root = db.collection(ROOT).doc(fixtureId);
  const orderRef = root.collection("orders").doc(orderId);
  const looseRef = root.collection("inventory").doc("loose-pieces");
  const sealedRef = root.collection("inventory").doc("sealed-cartons");
  const auditRef = root.collection("audit").doc(randomUUID());
  const movementRef = root.collection("movements").doc(randomUUID());

  return db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) fail("NOT_FOUND", "Order does not exist");
    const order = orderSnap.data();
    const plan = planOrderDecision({ currentStatus: order.status, decision });
    if (plan.outcome === "already_applied") {
      return { outcome: "already_applied", orderId, inventoryChanged: false };
    }

    let looseSnap = null, sealedSnap = null, trackingSnap = null;
    const trackingRef = order.trackingTokenHash
      ? root.collection("tracking").doc(order.trackingTokenHash)
      : null;
    if (decision === "confirm") {
      looseSnap = await tx.get(looseRef);
      sealedSnap = await tx.get(sealedRef);
    }
    if (trackingRef) trackingSnap = await tx.get(trackingRef);

    let stockPlan = null;
    if (decision === "confirm") {
      if (!looseSnap.exists || !sealedSnap.exists) {
        fail("FAILED_PRECONDITION", "Inventory balances are not initialized");
      }
      if (!Array.isArray(order.lines) || order.lines.length !== 1 ||
          !Number.isSafeInteger(order.lines[0].stockUnitsConsumed) ||
          order.lines[0].stockUnitsConsumed <= 0) {
        fail("FAILED_PRECONDITION", "This sample confirmation requires one whole-piece line");
      }
      const loose = looseSnap.data(), sealed = sealedSnap.data();
      stockPlan = planLooseStockSale({
        requestedUnits: order.lines[0].stockUnitsConsumed,
        looseUnits: loose.quantityOnHand,
        sealedPackages: sealed.quantityOnHand,
        unitsPerSealedPackage: sealed.unitsPerPackage
      });
      if (!stockPlan.feasible) fail("FAILED_PRECONDITION", "Insufficient stock to confirm this order");
    }

    tx.update(orderRef, {
      status: plan.nextStatus,
      confirmedAtMillis: decision === "confirm" ? now : null,
      rejectedAtMillis: decision === "reject" ? now : null,
      updatedAtMillis: now
    });
    if (trackingRef && trackingSnap?.exists) {
      tx.update(trackingRef, { status: plan.nextStatus, updatedAtMillis: now });
    }
    tx.create(auditRef, {
      action: decision === "confirm" ? "order_confirmed" : "order_rejected",
      orderId,
      createdAtMillis: now
    });

    if (stockPlan) {
      tx.update(looseRef, { quantityOnHand: stockPlan.looseUnitsAfter, updatedAtMillis: now });
      tx.update(sealedRef, { quantityOnHand: stockPlan.sealedPackagesAfter, updatedAtMillis: now });
      if (stockPlan.packagesToOpen > 0) {
        tx.create(movementRef, {
          type: "break_pack", orderId,
          packagesOpened: stockPlan.packagesToOpen,
          unitsTransferred: stockPlan.transferredUnits,
          createdAtMillis: now
        });
      }
      const saleRef = root.collection("movements").doc(randomUUID());
      tx.create(saleRef, {
        type: "sale", orderId,
        unitsDeducted: stockPlan.requestedUnits,
        createdAtMillis: now
      });
    }
    return {
      outcome: "confirmed",
      orderId,
      nextStatus: plan.nextStatus,
      inventoryChanged: Boolean(stockPlan),
      stock: stockPlan ? {
        looseUnitsAfter: stockPlan.looseUnitsAfter,
        sealedPackagesAfter: stockPlan.sealedPackagesAfter
      } : null
    };
  });
}
