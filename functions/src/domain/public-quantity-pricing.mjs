/**
 * Build a public-safe pricing projection from private authoritative tier config.
 *
 * The caller must write this projection through an authorized trusted backend.
 * This function deliberately copies only an allowlist of customer-safe fields.
 */
import { validateQuantityTierRule } from "./quantity-tier-engine.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer timestamp`);
  }
  return value;
}

export function buildPublicQuantityTierProjection({
  productId,
  variantId,
  rule,
  configVersion,
  nowMillis = Date.now()
}) {
  validId(productId, "productId");
  validId(variantId, "variantId");
  validId(configVersion, "configVersion");
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0) {
    throw new TypeError("nowMillis must be a non-negative safe integer");
  }
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new TypeError("rule must be an object");
  }
  const validation = validateQuantityTierRule(rule);
  if (!validation.valid) {
    fail("INVALID_TIER_CONFIGURATION", "Cannot publish an invalid quantity-tier rule");
  }
  const ruleId = validId(rule.id, "rule.id");
  const effectiveFromMillis = optionalTimestamp(rule.effectiveFromMillis, "effectiveFromMillis");
  const effectiveUntilMillis = optionalTimestamp(rule.effectiveUntilMillis, "effectiveUntilMillis");
  if (effectiveFromMillis !== null && effectiveUntilMillis !== null &&
      effectiveUntilMillis <= effectiveFromMillis) {
    throw new TypeError("effectiveUntilMillis must be later than effectiveFromMillis");
  }

  let publicationState = "published";
  if (!rule.enabled) publicationState = "disabled";
  else if (effectiveFromMillis !== null && nowMillis < effectiveFromMillis) publicationState = "scheduled";
  else if (effectiveUntilMillis !== null && nowMillis >= effectiveUntilMillis) publicationState = "expired";

  const tiers = rule.tiers
    .slice()
    .sort((a, b) => a.minimumQuantity - b.minimumQuantity)
    .map(tier => {
      const safeTier = {
        id: tier.id,
        minimumQuantity: tier.minimumQuantity,
        maximumQuantity: tier.maximumQuantity ?? null
      };
      if (rule.qualificationBasis === "base_stock_quantity") {
        safeTier.pricePerBaseUnitMinor = tier.pricePerBaseUnitMinor;
      } else {
        safeTier.priceBySellingOptionId = {
          [rule.eligibleSellingOptionIds[0]]:
            tier.priceBySellingOptionId[rule.eligibleSellingOptionIds[0]]
        };
      }
      return safeTier;
    });

  const active = publicationState === "published";
  return {
    publicPricingId: `${productId}__${variantId}__${ruleId}`,
    schemaVersion: 1,
    productId,
    variantId,
    ruleId,
    configVersion,
    enabled: active,
    publicationState,
    pricingMode: rule.pricingMode,
    qualificationBasis: rule.qualificationBasis,
    aggregateAcrossOptions: rule.aggregateAcrossOptions,
    eligibleSellingOptionIds: [...rule.eligibleSellingOptionIds],
    effectiveFromMillis,
    effectiveUntilMillis,
    tiers,
    currency: "NGN",
    updatedAtMillis: nowMillis
  };
}
