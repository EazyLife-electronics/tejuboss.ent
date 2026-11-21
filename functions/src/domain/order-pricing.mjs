/**
 * Deterministic catalogue line pricing.
 *
 * This is the trusted, tier-independent foundation for checkout. It prices
 * the exact selling option selected by stable IDs, validates order increments,
 * applies an explicitly configured promotional unit price, and returns stock
 * consumption. Quantity-tier semantics are intentionally handled separately
 * until the business confirms threshold vs marginal pricing.
 */

import { resolveCheckoutSelection } from "./catalogue.mjs";

function assertSafeMoney(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer in minor units`);
  }
}

function toScaledQuantity(value, precision, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive finite number`);
  }
  const scale = 10 ** precision;
  const scaled = Math.round(value * scale);
  if (!Number.isSafeInteger(scaled) || Math.abs(value * scale - scaled) > 1e-8) {
    throw new TypeError(`${field} exceeds the configured quantity precision`);
  }
  return { scaled, scale };
}

function roundedProduct(amountMinor, scaledQuantity, scale) {
  const numerator = BigInt(amountMinor) * BigInt(scaledQuantity);
  const result = (numerator + BigInt(Math.floor(scale / 2))) / BigInt(scale);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated line total exceeds safe integer range");
  }
  return Number(result);
}

/**
 * Price a single selected selling option.
 *
 * The caller must load the product and any applicable published pricing rules
 * from a trusted backend. Client-submitted prices are never accepted here.
 */
export function calculateCatalogueLinePrice({
  product,
  variantId,
  sellingOptionId,
  quantity
}) {
  const { variant, sellingOption } = resolveCheckoutSelection(
    product,
    variantId,
    sellingOptionId
  );

  assertSafeMoney(sellingOption.priceMinor, "priceMinor");
  const hasPromo = sellingOption.promoPriceMinor !== undefined &&
    sellingOption.promoPriceMinor !== null;
  if (hasPromo) {
    assertSafeMoney(sellingOption.promoPriceMinor, "promoPriceMinor");
    if (sellingOption.promoPriceMinor > sellingOption.priceMinor) {
      throw new RangeError("Promotional price cannot exceed base price");
    }
  }

  const precision = variant.quantityPrecision;
  const requested = toScaledQuantity(quantity, precision, "quantity");
  const minimum = toScaledQuantity(
    sellingOption.minimumOrderQuantity, precision, "minimumOrderQuantity"
  );
  const step = toScaledQuantity(
    sellingOption.orderQuantityStep, precision, "orderQuantityStep"
  );

  if (requested.scaled < minimum.scaled) {
    const error = new Error("Quantity is below the minimum order quantity");
    error.code = "MINIMUM_ORDER_QUANTITY";
    error.details = {
      minimumOrderQuantity: sellingOption.minimumOrderQuantity
    };
    throw error;
  }
  if ((requested.scaled - minimum.scaled) % step.scaled !== 0) {
    const error = new Error("Quantity does not match the configured order step");
    error.code = "INVALID_ORDER_QUANTITY_STEP";
    error.details = {
      minimumOrderQuantity: sellingOption.minimumOrderQuantity,
      orderQuantityStep: sellingOption.orderQuantityStep
    };
    throw error;
  }

  const unitPriceMinor = hasPromo
    ? sellingOption.promoPriceMinor
    : sellingOption.priceMinor;
  const subtotalMinor = roundedProduct(
    sellingOption.priceMinor, requested.scaled, requested.scale
  );
  const totalMinor = roundedProduct(
    unitPriceMinor, requested.scaled, requested.scale
  );
  const stockUnitsConsumed = quantity * sellingOption.stockUnitsPerSaleUnit;

  if (!Number.isSafeInteger(stockUnitsConsumed) && !Number.isFinite(stockUnitsConsumed)) {
    throw new RangeError("Calculated stock consumption is invalid");
  }
  if (!Number.isFinite(stockUnitsConsumed) || stockUnitsConsumed < 0) {
    throw new RangeError("Calculated stock consumption is invalid");
  }

  return {
    productId: product.id ?? null,
    variantId: variant.id,
    sellingOptionId: sellingOption.id,
    sellingUnitCode: sellingOption.unitCode,
    sellingUnitLabel: sellingOption.displayName,
    quantity,
    stockUnitCode: variant.stockUnit.code,
    stockUnitsPerSaleUnit: sellingOption.stockUnitsPerSaleUnit,
    stockUnitsConsumed,
    baseUnitPriceMinor: sellingOption.priceMinor,
    appliedUnitPriceMinor: unitPriceMinor,
    subtotalMinor,
    discountMinor: subtotalMinor - totalMinor,
    totalMinor,
    pricingSource: hasPromo ? "catalogue_promotion" : "catalogue_base"
  };
}
