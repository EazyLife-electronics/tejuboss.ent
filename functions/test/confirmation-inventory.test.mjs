import test from "node:test";
import assert from "node:assert/strict";
import { planConfirmedOrderInventory } from "../src/domain/confirmation-inventory.mjs";

const deduction = {
  balanceId: "loose",
  stockUnits: 6,
  stockUnitsPerBalanceUnit: 1,
  sealedBalanceId: "cartons",
  sealedInventoryFormId: "sealed-carton",
  unitsPerPackage: 48,
  productId: "sample",
  variantId: "piece",
  locationId: "store",
  inventoryFormId: "loose-piece",
  stockUnitCode: "piece"
};

test("uses loose stock first and opens a sealed carton only for the shortage", () => {
  const result = planConfirmedOrderInventory({
    deductions: [deduction],
    balancesById: new Map([
      ["loose", { quantityOnHand: 2 }],
      ["cartons", { quantityOnHand: 3 }]
    ])
  });
  assert.equal(result.updates.get("loose"), 42);
  assert.equal(result.updates.get("cartons"), 2);
  assert.deepEqual(result.movements.map(m => m.movementType), ["break_pack", "sale"]);
  assert.equal(result.movements[0].canonicalStockUnits, 48);
});

test("uses existing loose units without opening a package", () => {
  const result = planConfirmedOrderInventory({
    deductions: [deduction],
    balancesById: new Map([
      ["loose", { quantityOnHand: 20 }],
      ["cartons", { quantityOnHand: 3 }]
    ])
  });
  assert.equal(result.updates.get("loose"), 14);
  assert.equal(result.updates.get("cartons"), 3);
  assert.deepEqual(result.movements.map(m => m.movementType), ["sale"]);
});

test("fails closed when inventory is insufficient", () => {
  assert.throws(
    () => planConfirmedOrderInventory({
      deductions: [deduction],
      balancesById: new Map([
        ["loose", { quantityOnHand: 2 }],
        ["cartons", { quantityOnHand: 0 }]
      ])
    }),
    error => error.code === "INSUFFICIENT_STOCK"
  );
});

test("selling a sealed package deducts package balance units, not base units", () => {
  const result = planConfirmedOrderInventory({
    deductions: [{
      ...deduction,
      sealedBalanceId: null,
      stockUnits: 48,
      stockUnitsPerBalanceUnit: 48,
      inventoryFormId: "sealed-carton"
    }],
    balancesById: new Map([["loose", { quantityOnHand: 5 }]])
  });
  assert.equal(result.updates.get("loose"), 4);
  assert.equal(result.movements[0].quantity, 1);
  assert.equal(result.movements[0].canonicalStockUnits, 48);
});

test("rejects overlapping or duplicated balance snapshots", () => {
  assert.throws(
    () => planConfirmedOrderInventory({
      deductions: [deduction, { ...deduction, balanceId: "cartons", sealedBalanceId: null }],
      balancesById: new Map()
    }),
    error => error.code === "OVERLAPPING_INVENTORY_FORMS"
  );
});
