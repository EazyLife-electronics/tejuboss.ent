/**
 * Explicit quantity-tier pricing engine.
 *
 * This module is deliberately configuration-driven. It supports both
 * threshold (best reached rate applies to all eligible quantity) and
 * marginal (each band is priced at its own rate) behaviour. No default
 * commercial mode is selected by this module.
 *
 * All prices are integer minor units. No Firestore or browser dependencies.
 */

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value, field, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${field} must be a safe integer >= ${min}`);
  }
}

function invalid(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

/**
 * Rule contract:
 * {
 *   enabled: true,
 *   qualificationBasis: "selected_option_quantity" | "base_stock_quantity",
 *   aggregateAcrossOptions: boolean,
 *   eligibleSellingOptionIds: string[],
 *   pricingMode: "threshold" | "marginal",
 *   tiers: [{
 *     id, minimumQuantity, maximumQuantity?,
 *     pricePerBaseUnitMinor? (base_stock_quantity),
 *     priceBySellingOptionId? (selected_option_quantity)
 *   }]
 * }
 *
 * In selected-option mode, only one selling-option ID may be eligible in a
 * single rule. This keeps the rate's unit unambiguous. Separate rules can
 * serve piece, pack, roll and carton offers independently.
 */
export function validateQuantityTierRule(rule) {
  const issues = [];
  if (!record(rule)) return { valid: false, issues: ["Rule must be an object"] };
  if (typeof rule.enabled !== "boolean") issues.push("enabled must be boolean");
  if (!["selected_option_quantity", "base_stock_quantity"].includes(rule.qualificationBasis)) {
    issues.push("Unsupported qualificationBasis");
  }
  if (typeof rule.aggregateAcrossOptions !== "boolean") {
    issues.push("aggregateAcrossOptions must be boolean");
  }
  if (!["threshold", "marginal"].includes(rule.pricingMode)) {
    issues.push("pricingMode must be threshold or marginal");
  }
  if (!Array.isArray(rule.eligibleSellingOptionIds) || rule.eligibleSellingOptionIds.length === 0 ||
      rule.eligibleSellingOptionIds.some(x => typeof x !== "string" || !x.trim()) ||
      new Set(rule.eligibleSellingOptionIds).size !== rule.eligibleSellingOptionIds.length) {
    issues.push("eligibleSellingOptionIds must contain unique non-empty IDs");
  }
  if (rule.qualificationBasis === "selected_option_quantity" &&
      Array.isArray(rule.eligibleSellingOptionIds) && rule.eligibleSellingOptionIds.length !== 1) {
    issues.push("selected_option_quantity rules must target exactly one selling option");
  }
  if (!Array.isArray(rule.tiers) || rule.tiers.length === 0) {
    issues.push("At least one tier is required");
  } else {
    const ids = new Set();
    const ordered = [...rule.tiers].sort((a, b) => (a?.minimumQuantity ?? 0) - (b?.minimumQuantity ?? 0));
    for (const [index, tier] of ordered.entries()) {
      if (!record(tier)) {
        issues.push(`tiers[${index}] must be an object`);
        continue;
      }
      if (typeof tier.id !== "string" || !tier.id.trim() || ids.has(tier.id)) {
        issues.push(`tiers[${index}].id must be unique and non-empty`);
      } else ids.add(tier.id);
      if (!Number.isSafeInteger(tier.minimumQuantity) || tier.minimumQuantity < 1) {
        issues.push(`tiers[${index}].minimumQuantity must be a positive integer`);
      }
      if (tier.maximumQuantity !== undefined && tier.maximumQuantity !== null &&
          (!Number.isSafeInteger(tier.maximumQuantity) ||
           tier.maximumQuantity < tier.minimumQuantity)) {
        issues.push(`tiers[${index}].maximumQuantity must be >= minimumQuantity`);
      }
      if (rule.qualificationBasis === "base_stock_quantity") {
        if (!Number.isSafeInteger(tier.pricePerBaseUnitMinor) || tier.pricePerBaseUnitMinor < 0) {
          issues.push(`tiers[${index}].pricePerBaseUnitMinor must be a non-negative integer`);
        }
      } else {
        const optionId = rule.eligibleSellingOptionIds?.[0];
        const price = tier.priceBySellingOptionId?.[optionId];
        if (!Number.isSafeInteger(price) || price < 0) {
          issues.push(`tiers[${index}] requires a non-negative price for ${optionId}`);
        }
      }
      if (index > 0 && Number.isSafeInteger(ordered[index - 1].minimumQuantity) &&
          Number.isSafeInteger(tier.minimumQuantity) &&
          tier.minimumQuantity <= ordered[index - 1].minimumQuantity) {
        issues.push("Tier minimum quantities must be unique and increasing");
      }
      if (rule.pricingMode === "marginal" && index === 0 && tier.minimumQuantity !== 1) {
        issues.push("Marginal schedules must start at quantity 1");
      }
      if (rule.pricingMode === "marginal" && index > 0) {
        const previous = ordered[index - 1];
        if (previous.maximumQuantity !== tier.minimumQuantity - 1) {
          issues.push("Marginal tier bands must be contiguous and non-overlapping");
        }
      }
      if (rule.pricingMode === "marginal" && index === ordered.length - 1 &&
          tier.maximumQuantity !== undefined && tier.maximumQuantity !== null) {
        issues.push("Final marginal tier must have no maximumQuantity");
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

function assertRule(rule) {
  const result = validateQuantityTierRule(rule);
  if (!result.valid) {
    invalid("INVALID_TIER_CONFIGURATION", "Quantity tier configuration is invalid", result.issues);
  }
}

function chooseThresholdTier(tiers, quantity) {
  return [...tiers]
    .filter(t => quantity >= t.minimumQuantity &&
      (t.maximumQuantity == null || quantity <= t.maximumQuantity))
    .sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0] ?? null;
}

function roundMoney(numerator, denominator) {
  const result = (numerator + denominator / 2n) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Tier total exceeds safe integer range");
  }
  return Number(result);
}

/**
 * Price a quantity in the configured qualification unit.
 * Returns a detailed breakdown suitable for a cart/order snapshot.
 */
export function calculateQuantityTierPrice({ rule, quantity, baseUnitPriceMinor, sellingOptionId }) {
  assertRule(rule);
  safeInteger(quantity, "quantity", 1);
  safeInteger(baseUnitPriceMinor, "baseUnitPriceMinor");
  if (!rule.enabled) {
    return {
      applied: false,
      reason: "disabled",
      quantity,
      baseTotalMinor: quantity * baseUnitPriceMinor,
      totalMinor: quantity * baseUnitPriceMinor,
      discountMinor: 0,
      tierId: null
    };
  }

  const optionId = sellingOptionId ?? rule.eligibleSellingOptionIds[0];
  if (!rule.eligibleSellingOptionIds.includes(optionId)) {
    return {
      applied: false,
      reason: "selling_option_not_eligible",
      quantity,
      baseTotalMinor: quantity * baseUnitPriceMinor,
      totalMinor: quantity * baseUnitPriceMinor,
      discountMinor: 0,
      tierId: null
    };
  }

  let totalMinor;
  let appliedTierIds;
  if (rule.pricingMode === "threshold") {
    const tier = chooseThresholdTier(rule.tiers, quantity);
    if (!tier) {
      return {
        applied: false,
        reason: "threshold_not_reached",
        quantity,
        baseTotalMinor: quantity * baseUnitPriceMinor,
        totalMinor: quantity * baseUnitPriceMinor,
        discountMinor: 0,
        tierId: null
      };
    }
    const rate = rule.qualificationBasis === "base_stock_quantity"
      ? tier.pricePerBaseUnitMinor
      : tier.priceBySellingOptionId[optionId];
    totalMinor = roundMoney(BigInt(quantity) * BigInt(rate), 1n);
    appliedTierIds = [tier.id];
  } else {
    let remaining = quantity;
    let cursor = 1;
    let total = 0n;
    appliedTierIds = [];
    const tiers = [...rule.tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
    for (const tier of tiers) {
      if (remaining <= 0) break;
      const bandEnd = tier.maximumQuantity ?? quantity;
      const bandUnits = Math.max(0, Math.min(quantity, bandEnd) - cursor + 1);
      if (bandUnits > 0) {
        const rate = rule.qualificationBasis === "base_stock_quantity"
          ? tier.pricePerBaseUnitMinor
          : tier.priceBySellingOptionId[optionId];
        total += BigInt(bandUnits) * BigInt(rate);
        appliedTierIds.push(tier.id);
        remaining -= bandUnits;
      }
      cursor = bandEnd + 1;
    }
    if (remaining > 0) invalid("INVALID_TIER_CONFIGURATION", "Marginal schedule does not cover requested quantity");
    totalMinor = roundMoney(total, 1n);
  }

  const baseTotalMinor = quantity * baseUnitPriceMinor;
  if (!Number.isSafeInteger(baseTotalMinor)) {
    throw new RangeError("Base total exceeds safe integer range");
  }
  if (totalMinor > baseTotalMinor) {
    invalid("TIER_PRICE_INCREASE", "Quantity tier price cannot exceed the configured base total");
  }
  return {
    applied: true,
    reason: "qualified",
    quantity,
    baseTotalMinor,
    totalMinor,
    discountMinor: baseTotalMinor - totalMinor,
    tierId: appliedTierIds.length === 1 ? appliedTierIds[0] : null,
    appliedTierIds,
    pricingMode: rule.pricingMode,
    qualificationBasis: rule.qualificationBasis
  };
}
