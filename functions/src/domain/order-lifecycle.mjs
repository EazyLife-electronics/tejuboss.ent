/**
 * Order lifecycle policy for Tejuboss grocery orders.
 *
 * Inventory is deducted only by the trusted confirmation transaction.
 * This pure module describes allowed transitions; it does not write Firestore.
 */
const ORDER_STATES = new Set([
  "awaiting_confirmation",
  "confirmed",
  "rejected",
  "cancelled",
  "fulfilled"
]);

export function validateOrderState(value) {
  if (!ORDER_STATES.has(value)) throw new TypeError("Unknown order status");
  return value;
}

/**
 * Returns a transition decision for an authorized staff action.
 * The caller must enforce staff role and commit the status plus inventory
 * movements/balances atomically when action === "confirm".
 */
export function planOrderDecision({ currentStatus, decision }) {
  validateOrderState(currentStatus);
  if (decision !== "confirm" && decision !== "reject") {
    throw new TypeError("decision must be confirm or reject");
  }

  if (currentStatus === "confirmed" && decision === "confirm") {
    return {
      outcome: "already_applied",
      nextStatus: "confirmed",
      deductInventory: false,
      inventoryAction: null
    };
  }

  if (currentStatus !== "awaiting_confirmation") {
    const error = new Error("Only orders awaiting confirmation can be confirmed or rejected");
    error.code = "FAILED_PRECONDITION";
    throw error;
  }

  if (decision === "confirm") {
    return {
      outcome: "apply",
      nextStatus: "confirmed",
      deductInventory: true,
      inventoryAction: "deduct"
    };
  }

  return {
    outcome: "apply",
    nextStatus: "rejected",
    deductInventory: false,
    inventoryAction: null
  };
}
