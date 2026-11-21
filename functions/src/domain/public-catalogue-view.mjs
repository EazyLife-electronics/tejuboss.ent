import { validateCheckoutProduct } from "./catalogue.mjs";

/**
 * Convert a public structured catalogue document into a storefront-safe view model.
 * This is display data only. It deliberately contains no stock or checkout authority.
 */
export function toPublicCatalogueCard(document, documentId = "") {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("A published catalogue document is required");
  }
  if (document.published !== true) {
    throw new Error("Only published catalogue records can be displayed");
  }
  const validation = validateCheckoutProduct(document);
  if (!validation.valid) {
    const error = new Error("Published catalogue record is not valid for display");
    error.code = "INVALID_PUBLIC_CATALOGUE";
    error.details = validation.issues;
    throw error;
  }

  return {
    id: documentId || document.sourceDraftId,
    name: String(document.name || ""),
    brand: String(document.brand || ""),
    category: String(document.category || ""),
    description: String(document.description || ""),
    variants: document.variants.map(variant => ({
      id: variant.id,
      stockUnitLabel: String(variant.stockUnit?.label || variant.stockUnit?.code || ""),
      sellingOptions: variant.sellingOptions.map(option => ({
        id: option.id,
        label: option.displayName,
        unitCode: option.unitCode,
        priceMinor: option.priceMinor,
        promoPriceMinor: option.promoPriceMinor ?? null,
        minimumOrderQuantity: option.minimumOrderQuantity,
        orderQuantityStep: option.orderQuantityStep
      }))
    }))
  };
}

/** Display price only. Trusted checkout must independently re-read catalogue data. */
export function publicOptionUnitPrice(option) {
  if (!option || !Number.isSafeInteger(option.priceMinor) || option.priceMinor < 0) {
    throw new TypeError("A valid public selling-option price is required");
  }
  const promo = option.promoPriceMinor;
  return Number.isSafeInteger(promo) && promo >= 0 && promo < option.priceMinor
    ? promo
    : option.priceMinor;
}
