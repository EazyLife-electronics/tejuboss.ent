import { validateCheckoutProduct } from "./catalogue.mjs";

/**
 * Build the public storefront document from an approved private draft.
 * Inactive variants/options remain in the private draft, not the public sellable
 * projection. No stock quantities, supplier data, or internal pricing are copied.
 */
export function buildPublishedCatalogueProduct(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new TypeError("A catalogue draft is required");
  }
  if (draft.published !== true) {
    throw new Error("Draft must be explicitly marked for publication");
  }
  const variants = (Array.isArray(draft.variants) ? draft.variants : [])
    .filter(variant => variant?.active === true)
    .map(variant => ({
      id: variant.id,
      active: true,
      stockUnit: { code: variant.stockUnit?.code, label: variant.stockUnit?.label },
      quantityPrecision: variant.quantityPrecision,
      sellingOptions: (Array.isArray(variant.sellingOptions) ? variant.sellingOptions : [])
        .filter(option => option?.active === true)
        .map(option => ({
          id: option.id,
          unitCode: option.unitCode,
          displayName: option.displayName,
          stockUnitsPerSaleUnit: option.stockUnitsPerSaleUnit,
          minimumOrderQuantity: option.minimumOrderQuantity,
          orderQuantityStep: option.orderQuantityStep,
          active: true,
          priceMinor: option.priceMinor,
          ...(option.promoPriceMinor === undefined ? {} : { promoPriceMinor: option.promoPriceMinor })
        }))
    }))
    .filter(variant => variant.sellingOptions.length > 0);

  const product = {
    catalogueSchemaVersion: 2,
    sourceDraftId: draft.id,
    name: draft.name.trim(),
    brand: (draft.brand || "").trim(),
    category: draft.category.trim(),
    description: (draft.description || "").trim(),
    published: true,
    variants
  };
  const validation = validateCheckoutProduct(product);
  if (!validation.valid) {
    const error = new Error("Draft does not contain a valid active storefront catalogue");
    error.code = "INVALID_PUBLISHED_CATALOGUE";
    error.details = validation.issues;
    throw error;
  }
  return product;
}
