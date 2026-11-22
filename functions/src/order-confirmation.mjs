import { randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { planLooseStockSale } from "./domain/inventory-planning.mjs";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const db = () => getFirestore();

function authorize(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Staff sign-in is required.");
  const role = request.auth.token.role;
  if (role !== "owner" && role !== "order_manager") {
    throw new HttpsError("permission-denied", "Order manager access is required.");
  }
}
function validateInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => key !== "orderId" && key !== "decision")) {
    throw new HttpsError("invalid-argument", "Request must contain only orderId and decision.");
  }
  if (typeof data.orderId !== "string" || !ID.test(data.orderId)) {
    throw new HttpsError("invalid-argument", "Order ID is invalid.");
  }
  if (data.decision !== "confirm" && data.decision !== "reject") {
    throw new HttpsError("invalid-argument", "Decision must be confirm or reject.");
  }
  return data;
}

/**
 * Staff confirmation/rejection.
 * On confirmation, inventory deductions stored by the trusted order creator
 * are revalidated and deducted atomically with order status and movement logs.
 * This callable does not accept stock IDs or quantities from the client.
 */
export const decideOrder = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    authorize(request);
    const { orderId, decision } = validateInput(request.data);
    const firestore = db();
    const orderRef = firestore.collection("orders").doc(orderId);
    const auditRef = firestore.collection("auditLogs").doc();
    const now = Date.now();

    try {
      return await firestore.runTransaction(async tx => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) throw new HttpsError("not-found", "Order was not found.");
        const order = orderSnap.data();

        if (decision === "confirm" && order.status === "confirmed") {
          if (!Number.isSafeInteger(order.inventoryDeductedAtMillis)) {
            throw new HttpsError("failed-precondition", "Confirmed order has no inventory deduction marker. Manual reconciliation is required.");
          }
          return { success: true, outcome: "already_confirmed", orderId, inventoryDeducted: false };
        }
        if (decision === "reject" && order.status === "rejected") {
          return { success: true, outcome: "already_rejected", orderId, inventoryDeducted: false };
        }
        if (order.status !== "awaiting_confirmation") {
          throw new HttpsError("failed-precondition", "Only orders awaiting confirmation can be decided.");
        }

        const trackingRef = typeof order.trackingTokenHash === "string" &&
          /^[a-f0-9]{64}$/.test(order.trackingTokenHash)
          ? firestore.collection("orderTracking").doc(order.trackingTokenHash)
          : null;
        const deductions = decision === "confirm" ? order.inventoryDeductions : [];
        if (decision === "confirm" && (!Array.isArray(deductions) || deductions.length === 0)) {
          throw new HttpsError("failed-precondition", "Order has no trusted inventory deduction snapshot. It cannot be confirmed automatically.");
        }

        const normalized = [];
        const seen = new Set();
        for (const item of deductions) {
          if (!item || typeof item.balanceId !== "string" || !ID.test(item.balanceId) ||
              typeof item.stockUnits !== "number" || !Number.isSafeInteger(item.stockUnits) ||
              item.stockUnits <= 0 || seen.has(item.balanceId) ||
              !Number.isSafeInteger(item.stockUnitsPerBalanceUnit) || item.stockUnitsPerBalanceUnit <= 0 ||
              !["productId", "variantId", "locationId", "inventoryFormId", "stockUnitCode"].every(key => typeof item[key] === "string" && ID.test(item[key])) ||
              (item.sealedBalanceId !== null && item.sealedBalanceId !== undefined && (!ID.test(item.sealedBalanceId) || !Number.isSafeInteger(item.unitsPerPackage) || item.unitsPerPackage <= 0))) {
            throw new HttpsError("failed-precondition", "Order inventory snapshot is invalid or duplicated.");
          }
          seen.add(item.balanceId);
          normalized.push(item);
        }

        const allBalanceIds = [...new Set(normalized.flatMap(item =>
          item.sealedBalanceId ? [item.balanceId, item.sealedBalanceId] : [item.balanceId]
        ))];
        const balanceRefs = new Map(allBalanceIds.map(id => [
          id, firestore.collection("inventoryBalances").doc(id)
        ]));
        const balanceSnaps = decision === "confirm"
          ? new Map(await Promise.all([...balanceRefs.entries()].map(async ([id, ref]) => [id, await tx.get(ref)])))
          : new Map();
        const trackingSnap = trackingRef ? await tx.get(trackingRef) : null;

        const movementRefs = normalized.map(() =>
          firestore.collection("inventoryMovements").doc()
        );
        const breakMovementRefs = normalized.map(() =>
          firestore.collection("inventoryMovements").doc()
        );
        const nextStatus = decision === "confirm" ? "confirmed" : "rejected";
        tx.update(orderRef, {
          status: nextStatus,
          ...(decision === "confirm"
            ? { confirmedAtMillis: now, inventoryDeductedAtMillis: now }
            : { rejectedAtMillis: now }),
          updatedAtMillis: now,
          decisionBy: request.auth.uid
        });
        if (trackingRef && trackingSnap?.exists) {
          tx.update(trackingRef, { status: nextStatus, updatedAtMillis: now });
        }

        if (decision === "confirm") {
          for (let i = 0; i < normalized.length; i++) {
            const item = normalized[i];
            const primarySnap = balanceSnaps.get(item.balanceId);
            if (!primarySnap?.exists) {
              throw new HttpsError("failed-precondition", "One or more inventory balances have not been initialized.");
            }
            const primary = primarySnap.data();
            if (!Number.isSafeInteger(primary.quantityOnHand) || primary.quantityOnHand < 0) {
              throw new HttpsError("failed-precondition", "Inventory balance is malformed.");
            }

            let primaryAfter;
            let sealedAfter = null;
            let packagesOpened = 0;
            let transferredUnits = 0;
            let deductedBalanceUnits;

            if (item.sealedBalanceId) {
              if (item.stockUnitsPerBalanceUnit !== 1) {
                throw new HttpsError("failed-precondition", "Loose-stock fallback requires base stock units in the primary balance.");
              }
              const sealedSnap = balanceSnaps.get(item.sealedBalanceId);
              if (!sealedSnap?.exists) {
                throw new HttpsError("failed-precondition", "Sealed-package inventory has not been initialized.");
              }
              const sealed = sealedSnap.data();
              if (!Number.isSafeInteger(sealed.quantityOnHand) || sealed.quantityOnHand < 0) {
                throw new HttpsError("failed-precondition", "Sealed-package balance is malformed.");
              }
              const plan = planLooseStockSale({
                requestedUnits: item.stockUnits,
                looseUnits: primary.quantityOnHand,
                sealedPackages: sealed.quantityOnHand,
                unitsPerSealedPackage: item.unitsPerPackage
              });
              if (!plan.feasible) {
                throw new HttpsError("failed-precondition", "Insufficient loose and sealed stock to confirm this order.");
              }
              primaryAfter = plan.looseUnitsAfter;
              sealedAfter = plan.sealedPackagesAfter;
              packagesOpened = plan.packagesToOpen;
              transferredUnits = plan.transferredUnits;
              deductedBalanceUnits = item.stockUnits;
              tx.update(balanceRefs.get(item.balanceId), {
                quantityOnHand: primaryAfter,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: request.auth.uid
              });
              tx.update(balanceRefs.get(item.sealedBalanceId), {
                quantityOnHand: sealedAfter,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: request.auth.uid
              });
            } else {
              if (item.stockUnits % item.stockUnitsPerBalanceUnit !== 0) {
                throw new HttpsError("failed-precondition", "Order quantity cannot be represented in the selected inventory form.");
              }
              deductedBalanceUnits = item.stockUnits / item.stockUnitsPerBalanceUnit;
              if (primary.quantityOnHand < deductedBalanceUnits) {
                throw new HttpsError("failed-precondition", "Insufficient stock in the configured inventory form.");
              }
              primaryAfter = primary.quantityOnHand - deductedBalanceUnits;
              tx.update(balanceRefs.get(item.balanceId), {
                quantityOnHand: primaryAfter,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: request.auth.uid
              });
            }

            if (packagesOpened > 0) {
              tx.create(breakMovementRefs[i], {
                movementType: "break_pack",
                orderId,
                productId: item.productId,
                variantId: item.variantId,
                locationId: item.locationId,
                sourceInventoryFormId: item.sealedBalanceId,
                destinationInventoryFormId: item.inventoryFormId,
                packagesOpened,
                unitsTransferred: transferredUnits,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: request.auth.uid
              });
            }
            tx.create(movementRefs[i], {
              movementType: "sale",
              orderId,
              productId: item.productId,
              variantId: item.variantId,
              locationId: item.locationId,
              inventoryFormId: item.inventoryFormId,
              stockUnitCode: item.stockUnitCode,
              quantity: deductedBalanceUnits,
              canonicalStockUnits: item.stockUnits,
              balanceBefore: primary.quantityOnHand,
              balanceAfter: primaryAfter,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: request.auth.uid
            });
          }
        }

        tx.create(auditRef, {
          action: decision === "confirm" ? "order_confirmed" : "order_rejected",
          entityType: "order",
          entityId: orderId,
          actorUid: request.auth.uid,
          actorRole: request.auth.token.role,
          createdAt: FieldValue.serverTimestamp()
        });
        return {
          success: true,
          outcome: decision === "confirm" ? "confirmed" : "rejected",
          orderId,
          inventoryDeducted: decision === "confirm",
          inventoryLineCount: normalized.length
        };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("decideOrder failed", error);
      throw new HttpsError("internal", "Could not decide this order. No partial inventory changes were committed.");
    }
  }
);
