import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { validatePhysicalCountAdjustment } from "./domain/inventory-adjustment.mjs";

export const adjustInventoryPhysicalCount = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "inventory_manager") throw new HttpsError("permission-denied", "Inventory manager access is required.");
    let input;
    try { input = validatePhysicalCountAdjustment(request.data); }
    catch (error) { throw new HttpsError("invalid-argument", error.message); }
    const db = getFirestore();
    const balanceRef = db.collection("inventoryBalances").doc(input.balanceId);
    const movementRef = db.collection("inventoryMovements").doc();
    const auditRef = db.collection("auditLogs").doc();
    try {
      return await db.runTransaction(async tx => {
        const snapshot = await tx.get(balanceRef);
        if (!snapshot.exists) throw new HttpsError("not-found", "Inventory balance was not found.");
        const current = snapshot.data();
        if (current.quantityOnHand !== input.expectedQuantityOnHand) {
          throw new HttpsError("aborted", "Stock changed since it was loaded. Refresh and recount before saving.", {
            currentQuantityOnHand: current.quantityOnHand
          });
        }
        if (input.countedQuantity < (current.quantityReserved ?? 0)) throw new HttpsError("failed-precondition", "Physical count cannot be below the reserved quantity.");
        const delta = input.countedQuantity - current.quantityOnHand;
        if (delta === 0) return { success: true, unchanged: true, quantityOnHand: current.quantityOnHand };
        tx.update(balanceRef, {
          quantityOnHand: input.countedQuantity,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: request.auth.uid
        });
        tx.create(movementRef, {
          movementType: "physical_count_adjustment",
          balanceId: input.balanceId,
          productId: current.productId,
          variantId: current.variantId,
          locationId: current.locationId,
          inventoryFormId: current.inventoryFormId,
          quantityDelta: delta,
          quantityBefore: current.quantityOnHand,
          quantityAfter: input.countedQuantity,
          reason: input.reason,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: request.auth.uid
        });
        tx.create(auditRef, {
          action: "inventory_physical_count_adjusted",
          entityType: "inventory_balance",
          entityId: input.balanceId,
          quantityBefore: current.quantityOnHand,
          quantityAfter: input.countedQuantity,
          reason: input.reason,
          actorUid: request.auth.uid,
          actorRole: role,
          createdAt: FieldValue.serverTimestamp()
        });
        return { success: true, unchanged: false, quantityOnHand: input.countedQuantity, quantityDelta: delta };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("adjustInventoryPhysicalCount failed", error);
      throw new HttpsError("internal", "Physical count adjustment was not saved.");
    }
  }
);
