/**
 * Apply trusted quantity-tier configurations to already-priced catalogue lines.
 *
 * Rules are supplied by the trusted backend, never from the checkout payload.
 * Catalogue promotions and quantity tiers do not stack: a line already using
 * a promotional price is excluded from tier qualification and tier repricing.
 */
import {
  calculateQuantityTierPrice,
  deriveTierQualificationQuantity,
  validateQuantityTierRule
} from "./quantity-tier-engine.mjs";

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function distributeDiscount(discountMinor, lines) {
  const weights = lines.map(line => BigInt(line.totalMinor));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0n);
  if (discountMinor === 0 || totalWeight === 0n) return lines.map(() => 0);

  const target = BigInt(discountMinor);
  const allocations = weights.map(weight => Number((target * weight) / totalWeight));
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: (target * weight) % totalWeight
  }));
  let remaining = discountMinor - allocations.reduce((sum, value) => sum + value, 0);
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index :
      a.remainder > b.remainder ? -1 : 1
  );

  for (const entry of remainders) {
    if (remaining <= 0) break;
    if (allocations[entry.index] < lines[entry.index].totalMinor) {
      allocations[entry.index] += 1;
      remaining -= 1;
    }
  }
  if (remaining !== 0) {
    fail("FAILED_PRECONDITION", "Could not safely allocate quantity-tier discount");
  }
  return allocations;
}

/**
 * @param {object} input
 * @param {Array<object>} input.lines Trusted catalogue-priced lines.
 * @param {Array<{productId:string,variantId:string,rule:object}>} input.rules
 */
export function applyQuantityTierRules({ lines, rules = [] }) {
  if (!Array.isArray(lines) || !Array.isArray(rules)) {
    throw new TypeError("lines and rules must be arrays");
  }
  const pricedLines = lines.map(line => ({ ...line }));
  const appliedRules = [];
  const claimedLineIndexes = new Set();

  for (const entry of rules) {
    if (!entry || typeof entry.productId !== "string" ||
        typeof entry.variantId !== "string" || !entry.rule) {
      fail("INVALID_TIER_CONFIGURATION", "Each tier rule requires productId, variantId and rule");
    }
    const validation = validateQuantityTierRule(entry.rule);
    if (!validation.valid) {
      fail("INVALID_TIER_CONFIGURATION", "Quantity tier configuration is invalid", validation.issues);
    }
    if (!entry.rule.enabled) continue;

    const candidateIndexes = pricedLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) =>
        line.productId === entry.productId &&
        line.variantId === entry.variantId &&
        entry.rule.eligibleSellingOptionIds.includes(line.sellingOptionId) &&
        line.pricingSource !== "catalogue_promotion"
      );

    if (!candidateIndexes.length) continue;
    for (const { index } of candidateIndexes) {
      if (claimedLineIndexes.has(index)) {
        fail("INVALID_TIER_CONFIGURATION", "More than one enabled tier rule targets the same checkout line");
      }
    }

    const eligibleLines = candidateIndexes.map(({ line }) => ({
      sellingOptionId: line.sellingOptionId,
      quantity: line.quantity,
      stockUnitsPerSaleUnit: line.stockUnitsPerSaleUnit
    }));
    const qualificationQuantity = deriveTierQualificationQuantity({
      rule: entry.rule,
      lines: eligibleLines
    });
    if (qualificationQuantity < 1) continue;

    const baseTotalMinor = candidateIndexes.reduce(
      (sum, { line }) => sum + BigInt(line.totalMinor), 0n
    );
    if (baseTotalMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("FAILED_PRECONDITION", "Tier baseline exceeds supported money range");
    }

    const tierResult = calculateQuantityTierPrice({
      rule: entry.rule,
      quantity: qualificationQuantity,
      baseUnitPriceMinor: 0,
      baseTotalMinorOverride: Number(baseTotalMinor),
      sellingOptionId: eligibleLines[0].sellingOptionId
    });
    if (!tierResult.applied) continue;

    const allocationLines = candidateIndexes.map(({ line }) => line);
    const discounts = distributeDiscount(tierResult.discountMinor, allocationLines);
    candidateIndexes.forEach(({ line, index }, offset) => {
      const lineTierDiscount = discounts[offset];
      const nextTotal = line.totalMinor - lineTierDiscount;
      pricedLines[index] = {
        ...line,
        totalMinor: nextTotal,
        discountMinor: line.subtotalMinor - nextTotal,
        quantityTierDiscountMinor: lineTierDiscount,
        pricingSource: "quantity_tier",
        quantityTier: {
          ruleId: entry.rule.id ?? null,
          pricingMode: tierResult.pricingMode,
          qualificationBasis: tierResult.qualificationBasis,
          qualificationQuantity,
          tierId: tierResult.tierId,
          appliedTierIds: tierResult.appliedTierIds
        }
      };
      claimedLineIndexes.add(index);
    });
    appliedRules.push({
      productId: entry.productId,
      variantId: entry.variantId,
      qualificationQuantity,
      tierId: tierResult.tierId,
      appliedTierIds: tierResult.appliedTierIds,
      discountMinor: tierResult.discountMinor
    });
  }

  const subtotal = pricedLines.reduce((sum, line) => sum + BigInt(line.subtotalMinor), 0n);
  const discount = pricedLines.reduce((sum, line) => sum + BigInt(line.discountMinor), 0n);
  const total = pricedLines.reduce((sum, line) => sum + BigInt(line.totalMinor), 0n);
  for (const [label, value] of [["subtotal", subtotal], ["discount", discount], ["total", total]]) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("FAILED_PRECONDITION", `Calculated ${label} exceeds supported money range`);
    }
  }

  return {
    lines: pricedLines,
    subtotalMinor: Number(subtotal),
    discountMinor: Number(discount),
    merchandiseTotalMinor: Number(total),
    appliedTierRules: appliedRules
  };
}
