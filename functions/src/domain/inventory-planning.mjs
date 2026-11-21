/**
 * Pure planner for countable stock where sealed packages can be broken into
 * loose stock. This function plans balances only; callers must execute the
 * returned movements and sale deduction in one Firestore transaction.
 */

function assertWholeNonNegative(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function planLooseStockSale({
  requestedUnits,
  looseUnits,
  sealedPackages,
  unitsPerSealedPackage,
}) {
  assertWholeNonNegative(requestedUnits, "requestedUnits");
  assertWholeNonNegative(looseUnits, "looseUnits");
  assertWholeNonNegative(sealedPackages, "sealedPackages");

  if (requestedUnits === 0) {
    throw new RangeError("requestedUnits must be greater than zero");
  }
  if (!Number.isSafeInteger(unitsPerSealedPackage) || unitsPerSealedPackage <= 0) {
    throw new TypeError("unitsPerSealedPackage must be a positive safe integer");
  }

  const shortage = Math.max(0, requestedUnits - looseUnits);
  const packagesToOpen = Math.ceil(shortage / unitsPerSealedPackage);

  if (packagesToOpen > sealedPackages) {
    return {
      feasible: false,
      reason: "INSUFFICIENT_STOCK",
      requestedUnits,
      availableUnits: looseUnits + sealedPackages * unitsPerSealedPackage,
      packagesToOpen: 0,
      sealedPackagesAfter: sealedPackages,
      looseUnitsAfter: looseUnits,
      movements: [],
    };
  }

  const transferredUnits = packagesToOpen * unitsPerSealedPackage;
  const looseBeforeSale = looseUnits + transferredUnits;

  return {
    feasible: true,
    reason: null,
    requestedUnits,
    packagesToOpen,
    transferredUnits,
    sealedPackagesAfter: sealedPackages - packagesToOpen,
    looseUnitsAfter: looseBeforeSale - requestedUnits,
    movements: [
      ...(packagesToOpen > 0 ? [{
        type: "break_pack",
        packagesOpened: packagesToOpen,
        unitsTransferred: transferredUnits,
      }] : []),
      {
        type: "sale",
        unitsDeducted: requestedUnits,
      },
    ],
  };
}
