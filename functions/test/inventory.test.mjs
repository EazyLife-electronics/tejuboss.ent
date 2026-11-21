import test from "node:test";
import assert from "node:assert/strict";
import { planLooseSaleFromSealedCartons } from "../src/domain/inventory.mjs";

test("opens one carton and sells six units from ten cartons of 48", () => {
  const result = planLooseSaleFromSealedCartons({
    looseQuantity: 0,
    sealedCartonQuantity: 10,
    unitsPerCarton: 48,
    requestedQuantity: 6
  });

  assert.equal(result.openedCartons, 1);
  assert.equal(result.transferredUnits, 48);
  assert.deepEqual(result.balances, {
    sealedCartons: 9,
    looseUnits: 42
  });
  assert.deepEqual(result.movements.map(m => m.type), ["break_pack", "sale"]);
});

test("uses existing loose stock before opening a carton", () => {
  const result = planLooseSaleFromSealedCartons({
    looseQuantity: 8,
    sealedCartonQuantity: 10,
    unitsPerCarton: 48,
    requestedQuantity: 6
  });

  assert.equal(result.openedCartons, 0);
  assert.deepEqual(result.balances, {
    sealedCartons: 10,
    looseUnits: 2
  });
  assert.deepEqual(result.movements.map(m => m.type), ["sale"]);
});

test("opens only the number of cartons needed for the shortfall", () => {
  const result = planLooseSaleFromSealedCartons({
    looseQuantity: 2,
    sealedCartonQuantity: 10,
    unitsPerCarton: 48,
    requestedQuantity: 50
  });

  assert.equal(result.openedCartons, 1);
  assert.deepEqual(result.balances, {
    sealedCartons: 9,
    looseUnits: 0
  });
});

test("fails without changing balances when stock is insufficient", () => {
  assert.throws(
    () => planLooseSaleFromSealedCartons({
      looseQuantity: 2,
      sealedCartonQuantity: 0,
      unitsPerCarton: 48,
      requestedQuantity: 3
    }),
    error => error.code === "INSUFFICIENT_STOCK"
  );
});

test("rejects invalid package conversion and fractional piece quantities", () => {
  assert.throws(() => planLooseSaleFromSealedCartons({
    looseQuantity: 0,
    sealedCartonQuantity: 1,
    unitsPerCarton: 0,
    requestedQuantity: 1
  }), TypeError);

  assert.throws(() => planLooseSaleFromSealedCartons({
    looseQuantity: 0,
    sealedCartonQuantity: 1,
    unitsPerCarton: 48,
    requestedQuantity: 1.5
  }), TypeError);
});
