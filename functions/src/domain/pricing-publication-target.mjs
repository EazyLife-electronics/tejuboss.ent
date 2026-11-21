/**
 * Validate that a private quantity-pricing rule targets real, active,
 * structured catalogue selling options before it can be activated publicly.
 * Legacy products remain usable as disabled drafts, but cannot expose offers.
 */
export function validatePricingPublicationTarget({ product, variantId, rule }) {
  const issues = [];
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return { valid: false, issues: ["Product document does not exist"] };
  }
  if (product.published !== true) {
    issues.push("Product must be published before a public offer can be activated");
  }
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = variants.find(item => item && item.id === variantId);
  if (!variant) {
    issues.push("Selected variant does not exist in the product catalogue");
    return { valid: false, issues };
  }
  if (variant.active !== true) {
    issues.push("Selected variant is not active");
  }
  const options = Array.isArray(variant.sellingOptions) ? variant.sellingOptions : [];
  if (!options.length) {
    issues.push("Selected variant has no structured selling options");
  }
  const eligibleIds = Array.isArray(rule?.eligibleSellingOptionIds)
    ? rule.eligibleSellingOptionIds
    : [];
  for (const optionId of eligibleIds) {
    const option = options.find(item => item && item.id === optionId);
    if (!option) {
      issues.push(`Selling option ${optionId} does not exist in the selected variant`);
      continue;
    }
    if (option.active !== true) {
      issues.push(`Selling option ${optionId} is not active`);
    }
    if (!Number.isSafeInteger(option.stockUnitsPerSaleUnit) ||
        option.stockUnitsPerSaleUnit < 1) {
      issues.push(`Selling option ${optionId} has no valid stock-unit conversion`);
    }
  }
  return { valid: issues.length === 0, issues };
}
