import { randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { planConfirmedOrderInventory } from "./domain/confirmation-inventory.mjs";

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
              (item.sealedBalanceId !== null && item.sealedBalanceId !== undefined && (item.sealedBalanceId === item.balanceId || !ID.test(item.sealedBalanceId) || typeof item.sealedInventoryFormId !== "string" || !ID.test(item.sealedInventoryFormId) || !Number.isSafeInteger(item.unitsPerPackage) || item.unitsPerPackage <= 0))) {
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

        let stockPlan = null;
        if (decision === "confirm") {
          const balancesById = new Map();
          for (const balanceId of allBalanceIds) {
            const snap = balanceSnaps.get(balanceId);
            if (!snap?.exists) {
              throw new HttpsError("failed-precondition", "One or more inventory balances have not been initialized.");
            }
            balancesById.set(balanceId, snap.data());
          }
          try {
            stockPlan = planConfirmedOrderInventory({
              deductions: normalized,
              balancesById
            });
          } catch (error) {
            if (error?.code) throw new HttpsError("failed-precondition", error.message);
            throw error;
          }
        }

        const movementRefs = (stockPlan?.movements ?? []).map(() =>
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

        if (stockPlan) {
          for (const [balanceId, quantityOnHand] of stockPlan.updates.entries()) {
            tx.update(balanceRefs.get(balanceId), {
              quantityOnHand,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: request.auth.uid
            });
          }
          stockPlan.movements.forEach((movement, index) => {
            const snapshot = normalized.find(item =>
              item.balanceId === movement.balanceId || item.sealedBalanceId === movement.balanceId
            );
            tx.create(movementRefs[index], {
              ...movement,
              orderId,
              productId: snapshot.productId,
              variantId: snapshot.variantId,
              locationId: snapshot.locationId,
              stockUnitCode: snapshot.stockUnitCode,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: request.auth.uid
            });
          });
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
