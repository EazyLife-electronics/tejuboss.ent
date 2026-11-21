/**
 * Pure inventory planning functions.
 *
 * These functions calculate intended balance changes only. A trusted Firestore
 * transaction must read the current balances, call this planner, and commit all
 * balance and ledger writes atomically.
 */

function requireWholeNumber(value, field, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${field} must be a safe integer >= ${min}`);
  }
}

/**
 * Plan a loose-unit sale, opening the minimum whole number of sealed cartons
 * needed to cover any loose-stock shortfall.
 *
 * Example: 10 sealed cartons × 48 units, 0 loose, sale of 6 units =>
 * 9 sealed cartons and 42 loose units.
 */
export function planLooseSaleFromSealedCartons({
  looseQuantity,
  sealedCartonQuantity,
  unitsPerCarton,
  requestedQuantity
}) {
  requireWholeNumber(looseQuantity, "looseQuantity");
  requireWholeNumber(sealedCartonQuantity, "sealedCartonQuantity");
  requireWholeNumber(unitsPerCarton, "unitsPerCarton", { min: 1 });
  requireWholeNumber(requestedQuantity, "requestedQuantity", { min: 1 });

  const looseShortfall = Math.max(0, requestedQuantity - looseQuantity);
  const cartonsToOpen = Math.ceil(looseShortfall / unitsPerCarton);

  if (cartonsToOpen > sealedCartonQuantity) {
    const availableLooseEquivalent =
      looseQuantity + sealedCartonQuantity * unitsPerCarton;
    const error = new Error(
      `Insufficient stock: requested ${requestedQuantity}, available ${availableLooseEquivalent}`
    );
    error.code = "INSUFFICIENT_STOCK";
    error.details = {
      requestedQuantity,
      looseQuantity,
      sealedCartonQuantity,
      unitsPerCarton,
      availableLooseEquivalent
    };
    throw error;
  }

  const transferredUnits = cartonsToOpen * unitsPerCarton;
  const looseAfterOpening = looseQuantity + transferredUnits;
  const looseAfterSale = looseAfterOpening - requestedQuantity;
  const sealedCartonsAfter = sealedCartonQuantity - cartonsToOpen;

  return {
    openedCartons: cartonsToOpen,
    transferredUnits,
    soldLooseUnits: requestedQuantity,
    balances: {
      sealedCartons: sealedCartonsAfter,
      looseUnits: looseAfterSale
    },
    movements: [
      ...(cartonsToOpen > 0
        ? [{
            type: "break_pack",
            fromForm: "sealed_carton",
            fromQuantity: cartonsToOpen,
            toForm: "loose_unit",
            toQuantity: transferredUnits
          }]
        : []),
      {
        type: "sale",
        fromForm: "loose_unit",
        fromQuantity: requestedQuantity,
        toForm: null,
        toQuantity: 0
      }
    ]
  };
}
