import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export const listInventorySetup = onCall(
  { region: "europe-west1", enforceAppCheck: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Staff sign-in is required.");
    const role = request.auth.token.role;
    if (role !== "owner" && role !== "inventory_manager" && role !== "order_manager") {
      throw new HttpsError("permission-denied", "Inventory access is required.");
    }
    const db = getFirestore();
    try {
      const [formsSnap, balancesSnap, mappingsSnap] = await Promise.all([
        db.collection("inventoryForms").orderBy("label").limit(300).get(),
        db.collection("inventoryBalances").orderBy("updatedAt", "desc").limit(500).get(),
        db.collection("inventoryMappings").orderBy("updatedAt", "desc").limit(1000).get()
      ]);
      const forms = formsSnap.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, label: d.label, stockUnitCode: d.stockUnitCode,
          stockUnitsPerBalanceUnit: d.stockUnitsPerBalanceUnit };
      });
      const balances = balancesSnap.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, productId: d.productId, variantId: d.variantId,
          locationId: d.locationId, inventoryFormId: d.inventoryFormId,
          stockUnitCode: d.stockUnitCode, stockUnitsPerBalanceUnit: d.stockUnitsPerBalanceUnit,
          quantityOnHand: d.quantityOnHand, quantityReserved: d.quantityReserved ?? 0,
          updatedAt: d.updatedAt?.toMillis?.() ?? null };
      });
      const mappings = mappingsSnap.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, productId: d.productId, variantId: d.variantId,
          sellingOptionId: d.sellingOptionId, locationId: d.locationId,
          inventoryFormId: d.inventoryFormId, balanceId: d.balanceId,
          stockUnitCode: d.stockUnitCode, stockUnitsPerSaleUnit: d.stockUnitsPerSaleUnit,
          stockUnitsPerBalanceUnit: d.stockUnitsPerBalanceUnit,
          sealedInventoryFormId: d.sealedInventoryFormId ?? null,
          sealedBalanceId: d.sealedBalanceId ?? null, unitsPerPackage: d.unitsPerPackage ?? null,
          updatedAt: d.updatedAt?.toMillis?.() ?? null };
      });
      return { forms, balances, mappings, truncated: formsSnap.size === 300 || balancesSnap.size === 500 || mappingsSnap.size === 1000 };
    } catch (error) {
      console.error("listInventorySetup failed", error);
      throw new HttpsError("internal", "Could not load inventory records.");
    }
  }
);
