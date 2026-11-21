import test from "node:test";
import assert from "node:assert/strict";
import { planLooseStockSale } from "../src/domain/inventory-planning.mjs";

test("uses loose stock without opening sealed packages", () => {
  const plan = planLooseStockSale({
    requestedUnits: 6,
    looseUnits: 10,
    sealedPackages: 4,
    unitsPerSealedPackage: 48,
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.packagesToOpen, 0);
  assert.equal(plan.sealedPackagesAfter, 4);
  assert.equal(plan.looseUnitsAfter, 4);
  assert.deepEqual(plan.movements.map(x => x.type), ["sale"]);
});

test("opens the minimum whole packages and retains the remainder loose", () => {
  const plan = planLooseStockSale({
    requestedUnits: 6,
    looseUnits: 0,
    sealedPackages: 10,
    unitsPerSealedPackage: 48,
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.packagesToOpen, 1);
  assert.equal(plan.transferredUnits, 48);
  assert.equal(plan.sealedPackagesAfter, 9);
  assert.equal(plan.looseUnitsAfter, 42);
  assert.deepEqual(plan.movements.map(x => x.type), ["break_pack", "sale"]);
});

test("opens enough packages when loose stock covers only part of the sale", () => {
  const plan = planLooseStockSale({
    requestedUnits: 100,
    looseUnits: 5,
    sealedPackages: 3,
    unitsPerSealedPackage: 48,
  });
  assert.equal(plan.packagesToOpen, 2);
  assert.equal(plan.sealedPackagesAfter, 1);
  assert.equal(plan.looseUnitsAfter, 1);
});

test("fails safely without returning partial movements when stock is insufficient", () => {
  const plan = planLooseStockSale({
    requestedUnits: 100,
    looseUnits: 5,
    sealedPackages: 1,
    unitsPerSealedPackage: 48,
  });
  assert.equal(plan.feasible, false);
  assert.equal(plan.reason, "INSUFFICIENT_STOCK");
  assert.deepEqual(plan.movements, []);
  assert.equal(plan.sealedPackagesAfter, 1);
  assert.equal(plan.looseUnitsAfter, 5);
});

test("rejects fractional quantities for countable piece inventory", () => {
  assert.throws(() => planLooseStockSale({
    requestedUnits: 1.5,
    looseUnits: 0,
    sealedPackages: 1,
    unitsPerSealedPackage: 48,
  }), /safe integer/);
});

test("rejects zero and invalid package conversions", () => {
  assert.throws(() => planLooseStockSale({
    requestedUnits: 0,
    looseUnits: 0,
    sealedPackages: 1,
    unitsPerSealedPackage: 48,
  }), /greater than zero/);
  assert.throws(() => planLooseStockSale({
    requestedUnits: 1,
    looseUnits: 0,
    sealedPackages: 1,
    unitsPerSealedPackage: 0,
  }), /positive safe integer/);
});
