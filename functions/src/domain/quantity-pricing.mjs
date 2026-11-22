/**
 * Pure quantity-pricing calculations.
 *
 * Amounts are integer minor units (kobo for NGN). This module does not read
 * Firestore and does not decide which commercial rules an administrator
 * should enable. A trusted service must load and validate published rules,
 * then call these deterministic calculations.
 */

function requireSafeInteger(value, field, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${field} must be a safe integer >= ${min}`);
  }
}

/**
 * Calculate a package-equivalent blended total without changing the physical
 * selling option selected by the customer.
 *
 * Example: 10 units, reference pack contains 6, pack price ₦5,000,
 * remainder unit price ₦1,000 => ₦9,000 total.
 */
export function calculateBlendedPackagePrice({
  baseQuantity,
  packageBaseQuantity,
  packagePriceMinor,
  remainderUnitPriceMinor
}) {
  requireSafeInteger(baseQuantity, "baseQuantity");
  requireSafeInteger(packageBaseQuantity, "packageBaseQuantity", { min: 1 });
  requireSafeInteger(packagePriceMinor, "packagePriceMinor");
  requireSafeInteger(remainderUnitPriceMinor, "remainderUnitPriceMinor");

  const packageCount = Math.floor(baseQuantity / packageBaseQuantity);
  const remainderQuantity = baseQuantity % packageBaseQuantity;
  const packageTotalBig = BigInt(packageCount) * BigInt(packagePriceMinor);
  const remainderTotalBig = BigInt(remainderQuantity) * BigInt(remainderUnitPriceMinor);
  const totalBig = packageTotalBig + remainderTotalBig;

  if (totalBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated total exceeds safe integer range");
  }

  const packageTotalMinor = Number(packageTotalBig);
  const remainderTotalMinor = Number(remainderTotalBig);
  const totalMinor = Number(totalBig);

  return {
    packageCount,
    remainderQuantity,
    packageTotalMinor,
    remainderTotalMinor,
    totalMinor,
    effectiveUnitPriceMinor: baseQuantity > 0
      ? Math.round(totalMinor / baseQuantity)
      : 0
  };
}

/** Calculate a fixed effective price for each eligible base unit. */
export function calculateFixedEffectiveUnitPrice({
  baseQuantity,
  pricePerBaseUnitMinor
}) {
  requireSafeInteger(baseQuantity, "baseQuantity");
  requireSafeInteger(pricePerBaseUnitMinor, "pricePerBaseUnitMinor");
  const totalMinor = baseQuantity * pricePerBaseUnitMinor;
  if (!Number.isSafeInteger(totalMinor)) {
    throw new RangeError("Calculated total exceeds safe integer range");
  }
  return {
    totalMinor,
    effectiveUnitPriceMinor: baseQuantity > 0 ? pricePerBaseUnitMinor : 0
  };
}

/** Apply a percentage discount expressed in basis points (100 = 1%). */
export function calculatePercentageDiscount({
  baseTotalMinor,
  discountBasisPoints
}) {
  requireSafeInteger(baseTotalMinor, "baseTotalMinor");
  requireSafeInteger(discountBasisPoints, "discountBasisPoints");
  if (discountBasisPoints > 10000) {
    throw new RangeError("discountBasisPoints cannot exceed 10000");
  }
  const discountBig = (
    BigInt(baseTotalMinor) * BigInt(discountBasisPoints) + 5000n
  ) / 10000n;
  const discountMinor = Number(discountBig);
  return {
    baseTotalMinor,
    discountMinor,
    totalMinor: baseTotalMinor - discountMinor
  };
}

/** Apply a fixed amount reduction to a line/order basis, never below zero. */
export function calculateFixedAmountDiscount({
  baseTotalMinor,
  discountMinor
}) {
  requireSafeInteger(baseTotalMinor, "baseTotalMinor");
  requireSafeInteger(discountMinor, "discountMinor");
  const appliedDiscountMinor = Math.min(baseTotalMinor, discountMinor);
  return {
    baseTotalMinor,
    discountMinor: appliedDiscountMinor,
    totalMinor: baseTotalMinor - appliedDiscountMinor
  };
}

/**
 * Convert an order quantity into the configured qualification quantity.
 * The caller decides whether quantities from multiple options may aggregate.
 */
export function toBaseQuantity({ quantity, stockUnitsPerSaleUnit }) {
  requireSafeInteger(quantity, "quantity", { min: 1 });
  requireSafeInteger(stockUnitsPerSaleUnit, "stockUnitsPerSaleUnit", { min: 1 });
  const baseQuantity = quantity * stockUnitsPerSaleUnit;
  if (!Number.isSafeInteger(baseQuantity)) {
    throw new RangeError("Calculated base quantity exceeds safe integer range");
  }
  return baseQuantity;
}

/** Test a configured tier threshold against an already-derived quantity. */
export function tierQualifies({
  quantity,
  minimumQuantity,
  maximumQuantity = null
}) {
  requireSafeInteger(quantity, "quantity");
  requireSafeInteger(minimumQuantity, "minimumQuantity", { min: 1 });
  if (maximumQuantity !== null) {
    requireSafeInteger(maximumQuantity, "maximumQuantity", { min: 1 });
    if (maximumQuantity < minimumQuantity) {
      throw new RangeError("maximumQuantity cannot be less than minimumQuantity");
    }
  }
  return quantity >= minimumQuantity &&
    (maximumQuantity === null || quantity <= maximumQuantity);
}
