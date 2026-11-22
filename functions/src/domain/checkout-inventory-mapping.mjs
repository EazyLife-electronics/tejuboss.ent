/**
 * Convert trusted checkout lines and server-owned inventory mappings into
 * deterministic stock deductions. This is a planning function only; it never
 * reads or mutates Firestore balances.
 */
import { calculateStockUnitsRequired } from "./catalogue.mjs";

const ID = /^[A-Za-z0-9_.-]{1,128}$/;

function fail(message) {
  const error = new Error(message);
  error.code = "INVALID_INVENTORY_MAPPING";
  throw error;
}

export function buildCheckoutInventoryDeductions({ items, productsById, mappingRecords }) {
  if (!Array.isArray(items) || !(productsById instanceof Map) || !Array.isArray(mappingRecords) ||
      mappingRecords.length !== items.length) {
    throw new TypeError("Checkout items, products and inventory mappings must align.");
  }

  const byBalance = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const product = productsById.get(item.productId);
    const variant = product?.variants?.find(v => v.id === item.variantId && v.active === true);
    const option = variant?.sellingOptions?.find(o => o.id === item.sellingOptionId && o.active === true);
    const mapping = mappingRecords[i];
    if (!mapping) fail("Inventory mapping is not configured for one or more selected items.");
    if (!option || !Number.isSafeInteger(option.stockUnitsPerSaleUnit) ||
        !Number.isSafeInteger(mapping.stockUnitsPerSaleUnit) ||
        mapping.stockUnitsPerSaleUnit !== option.stockUnitsPerSaleUnit ||
        !Number.isSafeInteger(mapping.stockUnitsPerBalanceUnit) || mapping.stockUnitsPerBalanceUnit <= 0 ||
        typeof mapping.balanceId !== "string" || !ID.test(mapping.balanceId) ||
        !["productId", "variantId", "locationId", "inventoryFormId", "stockUnitCode"]
          .every(key => typeof mapping[key] === "string" && ID.test(mapping[key])) ||
        mapping.productId !== item.productId || mapping.variantId !== item.variantId ||
        mapping.sellingOptionId !== item.sellingOptionId) {
      fail("Inventory mapping does not match the current published selling option.");
    }

    if (mapping.sealedBalanceId != null &&
        (mapping.stockUnitsPerBalanceUnit !== 1 ||
         typeof mapping.sealedBalanceId !== "string" || !ID.test(mapping.sealedBalanceId) ||
         mapping.sealedBalanceId === mapping.balanceId ||
         !Number.isSafeInteger(mapping.unitsPerPackage) || mapping.unitsPerPackage <= 0 ||
         typeof mapping.sealedInventoryFormId !== "string" || !ID.test(mapping.sealedInventoryFormId))) {
      fail("Sealed-package fallback mapping is invalid.");
    }

    let stockUnits;
    try {
      stockUnits = calculateStockUnitsRequired({
        quantity: item.quantity,
        sellingOption: option,
        quantityPrecision: variant.quantityPrecision
      });
    } catch {
      fail("Selling quantity cannot be represented by the configured stock conversion.");
    }
    if (!Number.isSafeInteger(stockUnits) || stockUnits <= 0) {
      fail("Selling quantity must resolve to a whole canonical stock-unit quantity.");
    }

    const prior = byBalance.get(mapping.balanceId);
    const normalized = {
      balanceId: mapping.balanceId,
      productId: mapping.productId,
      variantId: mapping.variantId,
      locationId: mapping.locationId,
      inventoryFormId: mapping.inventoryFormId,
      stockUnitCode: mapping.stockUnitCode,
      stockUnitsPerBalanceUnit: mapping.stockUnitsPerBalanceUnit,
      sealedBalanceId: mapping.sealedBalanceId ?? null,
      sealedInventoryFormId: mapping.sealedInventoryFormId ?? null,
      unitsPerPackage: mapping.unitsPerPackage ?? null,
      stockUnits
    };
    if (prior) {
      const fields = ["productId", "variantId", "locationId", "inventoryFormId",
        "stockUnitCode", "stockUnitsPerBalanceUnit", "sealedBalanceId",
        "sealedInventoryFormId", "unitsPerPackage"];
      if (fields.some(key => prior[key] !== normalized[key])) {
        fail("Conflicting inventory mappings share a balance.");
      }
      prior.stockUnits += stockUnits;
      if (!Number.isSafeInteger(prior.stockUnits)) fail("Combined stock quantity exceeds supported range.");
    } else {
      byBalance.set(mapping.balanceId, normalized);
    }
  }

  const deductions = [...byBalance.values()];
  const primaryIds = new Set(deductions.map(item => item.balanceId));
  const fallbackIds = new Set();
  for (const item of deductions) {
    if (item.sealedBalanceId) {
      if (primaryIds.has(item.sealedBalanceId) || fallbackIds.has(item.sealedBalanceId)) {
        fail("Basket requires overlapping package balances; staff must split or reconfigure these inventory mappings.");
      }
      fallbackIds.add(item.sealedBalanceId);
    }
  }
  return deductions;
}
