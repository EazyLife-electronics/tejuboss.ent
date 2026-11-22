/**
 * Deterministic delivery calculator.
 *
 * Supported methods are intentionally narrow until the business approves a
 * replacement for the legacy cascading discount:
 * - flat_per_order: one base charge per delivery order.
 * - per_selling_unit: trusted line quantities multiplied by trusted fees.
 *
 * Zone fees are additive. Pickup is always free. No implicit discounts,
 * cart-order processing, or browser-supplied prices are accepted.
 */

const METHODS = new Set(["flat_per_order", "per_selling_unit"]);

function assertMoney(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer in kobo`);
  }
}

function assertQuantity(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
}

export function calculateDeliveryCharge({
  policy,
  fulfilmentMethod,
  areaId = null,
  lines = [],
}) {
  if (fulfilmentMethod === "pickup") {
    return {
      deliveryFeeMinor: 0,
      currency: "NGN",
      policyVersion: policy?.version ?? null,
      calculationMethod: "pickup",
      breakdown: [],
    };
  }
  if (fulfilmentMethod !== "delivery") {
    throw new TypeError("fulfilmentMethod must be delivery or pickup");
  }
  if (!policy || policy.enabled !== true || typeof policy.version !== "string" || !policy.version) {
    throw new Error("DELIVERY_POLICY_UNAVAILABLE");
  }
  if (!METHODS.has(policy.method)) {
    throw new Error("DELIVERY_METHOD_NOT_SUPPORTED");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new TypeError("delivery lines must be a non-empty array");
  }

  assertMoney(policy.baseFeeMinor, "policy.baseFeeMinor");
  if (policy.zoneFeesMinor && !areaId) {
    throw new Error("DELIVERY_AREA_REQUIRED");
  }
  const zoneFeeMinor = policy.zoneFeesMinor
    ? (policy.zoneFeesMinor[areaId] ?? null)
    : 0;

  if (zoneFeeMinor === null) {
    throw new Error("DELIVERY_AREA_UNSUPPORTED");
  }
  assertMoney(zoneFeeMinor, "zone fee");

  let lineFees = 0;
  const breakdown = [];

  for (const line of lines) {
    if (!line || typeof line.sellingOptionId !== "string" || !line.sellingOptionId) {
      throw new TypeError("each line requires a sellingOptionId");
    }
    assertQuantity(line.quantity, "line.quantity");

    if (policy.method === "per_selling_unit") {
      const override = policy.optionFeesMinor?.[line.sellingOptionId];
      const feeMinor = override ?? policy.baseFeeMinor;
      assertMoney(feeMinor, "selling-option delivery fee");
      const lineFeeMinor = Math.round(feeMinor * line.quantity);
      if (!Number.isSafeInteger(lineFeeMinor)) {
        throw new RangeError("delivery line fee exceeds safe integer range");
      }
      lineFees += lineFeeMinor;
      breakdown.push({ sellingOptionId: line.sellingOptionId, quantity: line.quantity, feeMinor, lineFeeMinor });
    }
  }

  const baseFeeMinor = policy.method === "flat_per_order" ? policy.baseFeeMinor : 0;
  const deliveryFeeMinor = baseFeeMinor + lineFees + zoneFeeMinor;
  if (!Number.isSafeInteger(deliveryFeeMinor)) {
    throw new RangeError("delivery total exceeds safe integer range");
  }

  return {
    deliveryFeeMinor,
    currency: "NGN",
    policyVersion: policy.version,
    calculationMethod: policy.method,
    baseFeeMinor,
    lineFeesMinor: lineFees,
    zoneFeeMinor,
    breakdown,
  };
}
