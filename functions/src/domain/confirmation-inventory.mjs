import { planLooseStockSale } from "./inventory-planning.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Pure stock confirmation planner. Input balances are read from the trusted
 * transaction snapshot; this function performs no writes.
 */
export function planConfirmedOrderInventory({ deductions, balancesById }) {
  if (!Array.isArray(deductions) || deductions.length === 0 ||
      !(balancesById instanceof Map)) {
    throw new TypeError("deductions and a balance snapshot Map are required");
  }
  const primaryIds = new Set();
  const fallbackIds = new Set();
  for (const item of deductions) {
    if (!item || typeof item.balanceId !== "string" ||
        !Number.isSafeInteger(item.stockUnits) || item.stockUnits <= 0 ||
        !Number.isSafeInteger(item.stockUnitsPerBalanceUnit) || item.stockUnitsPerBalanceUnit <= 0 ||
        primaryIds.has(item.balanceId)) {
      fail("INVALID_INVENTORY_SNAPSHOT", "Inventory deduction snapshot is malformed or duplicated");
    }
    primaryIds.add(item.balanceId);
  }
  for (const item of deductions) {
    if (item.sealedBalanceId) {
      if (item.sealedBalanceId === item.balanceId ||
          primaryIds.has(item.sealedBalanceId) ||
          fallbackIds.has(item.sealedBalanceId) ||
          !Number.isSafeInteger(item.unitsPerPackage) || item.unitsPerPackage <= 0) {
        fail("OVERLAPPING_INVENTORY_FORMS", "Order contains overlapping package balances");
      }
      fallbackIds.add(item.sealedBalanceId);
    }
  }

  const updates = new Map();
  const movements = [];
  for (const item of deductions) {
    const primary = balancesById.get(item.balanceId);
    if (!primary || !Number.isSafeInteger(primary.quantityOnHand) || primary.quantityOnHand < 0) {
      fail("INVENTORY_NOT_INITIALIZED", "Inventory balance is missing or malformed");
    }
    if (item.sealedBalanceId) {
      if (item.stockUnitsPerBalanceUnit !== 1) {
        fail("INVALID_PACKAGE_MAPPING", "Loose-stock fallback requires base units in its primary balance");
      }
      const sealed = balancesById.get(item.sealedBalanceId);
      if (!sealed || !Number.isSafeInteger(sealed.quantityOnHand) || sealed.quantityOnHand < 0) {
        fail("INVENTORY_NOT_INITIALIZED", "Sealed-package balance is missing or malformed");
      }
      const plan = planLooseStockSale({
        requestedUnits: item.stockUnits,
        looseUnits: primary.quantityOnHand,
        sealedPackages: sealed.quantityOnHand,
        unitsPerSealedPackage: item.unitsPerPackage
      });
      if (!plan.feasible) fail("INSUFFICIENT_STOCK", "Not enough loose or sealed stock to confirm this order");
      updates.set(item.balanceId, plan.looseUnitsAfter);
      updates.set(item.sealedBalanceId, plan.sealedPackagesAfter);
      if (plan.packagesToOpen > 0) {
        movements.push({
          movementType: "break_pack",
          balanceId: item.sealedBalanceId,
          destinationBalanceId: item.balanceId,
          quantity: plan.packagesToOpen,
          canonicalStockUnits: plan.transferredUnits,
          sourceInventoryFormId: item.sealedInventoryFormId,
          destinationInventoryFormId: item.inventoryFormId
        });
      }
      movements.push({
        movementType: "sale",
        balanceId: item.balanceId,
        quantity: item.stockUnits,
        canonicalStockUnits: item.stockUnits,
        balanceBefore: primary.quantityOnHand,
        balanceAfter: plan.looseUnitsAfter,
        inventoryFormId: item.inventoryFormId
      });
    } else {
      if (item.stockUnits % item.stockUnitsPerBalanceUnit !== 0) {
        fail("STOCK_UNIT_CONVERSION", "Sale quantity cannot be represented in this inventory form");
      }
      const balanceUnits = item.stockUnits / item.stockUnitsPerBalanceUnit;
      if (primary.quantityOnHand < balanceUnits) fail("INSUFFICIENT_STOCK", "Insufficient stock in the selected inventory form");
      const after = primary.quantityOnHand - balanceUnits;
      updates.set(item.balanceId, after);
      movements.push({
        movementType: "sale",
        balanceId: item.balanceId,
        quantity: balanceUnits,
        canonicalStockUnits: item.stockUnits,
        balanceBefore: primary.quantityOnHand,
        balanceAfter: after,
        inventoryFormId: item.inventoryFormId
      });
    }
  }
  return { updates, movements };
}
