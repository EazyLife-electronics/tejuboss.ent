/**
 * Match public quantity-tier projections to the structured catalogue.
 * Only published/enabled projections should be supplied by the caller.
 */
function safeText(value) {
  return typeof value === "string" ? value : "";
}

export function getPublicOffersForVariant({ productId, variant, publicPricing = [] }) {
  if (typeof productId !== "string" || !variant || typeof variant.id !== "string" ||
      !Array.isArray(publicPricing)) {
    throw new TypeError("Product, variant and public pricing records are required");
  }
  const optionsById = new Map((variant.sellingOptions || []).map(option => [option.id, option]));
  return publicPricing
    .filter(rule =>
      rule?.enabled === true &&
      rule?.publicationState === "published" &&
      rule.productId === productId &&
      rule.variantId === variant.id &&
      Array.isArray(rule.tiers) &&
      Array.isArray(rule.eligibleSellingOptionIds)
    )
    .map(rule => {
      const eligibleOptions = rule.eligibleSellingOptionIds
        .map(id => optionsById.get(id))
        .filter(Boolean);
      if (!eligibleOptions.length) return null;
      const tiers = rule.tiers
        .filter(tier => Number.isSafeInteger(tier.minimumQuantity) && tier.minimumQuantity > 0)
        .map(tier => ({
          id: safeText(tier.id),
          minimumQuantity: tier.minimumQuantity,
          maximumQuantity: Number.isSafeInteger(tier.maximumQuantity) ? tier.maximumQuantity : null,
          pricePerBaseUnitMinor: Number.isSafeInteger(tier.pricePerBaseUnitMinor)
            ? tier.pricePerBaseUnitMinor : null,
          priceBySellingOptionId: tier.priceBySellingOptionId &&
            typeof tier.priceBySellingOptionId === "object"
            ? tier.priceBySellingOptionId : {}
        }));
      if (!tiers.length) return null;
      return {
        id: safeText(rule.publicPricingId),
        qualificationBasis: rule.qualificationBasis,
        pricingMode: rule.pricingMode,
        aggregateAcrossOptions: rule.aggregateAcrossOptions === true,
        eligibleSellingOptionIds: [...rule.eligibleSellingOptionIds],
        eligibleOptions,
        tiers
      };
    })
    .filter(Boolean);
}

/** Return customer-facing tier rows with explicit units and integer-minor prices. */
export function formatPublicOfferRows(offer) {
  if (!offer || !Array.isArray(offer.tiers) || !Array.isArray(offer.eligibleOptions)) {
    throw new TypeError("A public offer is required");
  }
  const unit = offer.qualificationBasis === "base_stock_quantity"
    ? "base stock unit"
    : offer.eligibleOptions[0]?.displayName || "selling unit";
  return offer.tiers.map(tier => {
    const rates = offer.qualificationBasis === "base_stock_quantity"
      ? (Number.isSafeInteger(tier.pricePerBaseUnitMinor)
          ? [{ unit: "base stock unit", priceMinor: tier.pricePerBaseUnitMinor }]
          : [])
      : offer.eligibleOptions
          .map(option => ({
            unit: option.displayName,
            priceMinor: tier.priceBySellingOptionId[option.id]
          }))
          .filter(rate => Number.isSafeInteger(rate.priceMinor));
    return {
      minimumQuantity: tier.minimumQuantity,
      maximumQuantity: tier.maximumQuantity,
      qualificationUnit: unit,
      rates
    };
  });
}
