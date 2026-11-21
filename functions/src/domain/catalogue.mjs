/**
 * Checkout catalogue contract validation.
 *
 * This deliberately validates the new structured model rather than guessing
 * selling units or conversions from product labels, SKUs or names.
 * It is a pure module: no Firestore access and no mutation.
 */

const UNIT_CODE = /^[a-z][a-z0-9_-]{0,31}$/;

function issue(path, message) {
  return { path, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validPositiveQuantity(value, precision) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return false;
  }
  const scaled = value * (10 ** precision);
  return Number.isSafeInteger(Math.round(scaled)) &&
    Math.abs(scaled - Math.round(scaled)) < 1e-8;
}

/**
 * Validate one product document before it can be used for trusted checkout.
 *
 * Expected model:
 * product: { published, variants: [{ id, active, stockUnit,
 *   quantityPrecision, sellingOptions: [{ id, unitCode, displayName,
 *   stockUnitsPerSaleUnit, minimumOrderQuantity, orderQuantityStep,
 *   active, priceMinor, promoPriceMinor? }] }] }
 */
export function validateCheckoutProduct(product) {
  const issues = [];
  if (!isRecord(product)) {
    return { valid: false, issues: [issue("$", "Product must be an object")] };
  }

  if (product.published !== true) {
    issues.push(issue("published", "Product is not published"));
  }
  if (!Array.isArray(product.variants) || product.variants.length === 0) {
    issues.push(issue("variants", "Product must have at least one structured variant"));
    return { valid: false, issues };
  }

  const variantIds = new Set();
  product.variants.forEach((variant, index) => {
    const path = `variants[${index}]`;
    if (!isRecord(variant)) {
      issues.push(issue(path, "Variant must be an object"));
      return;
    }
    if (typeof variant.id !== "string" || !variant.id.trim()) {
      issues.push(issue(`${path}.id`, "Stable variant ID is required"));
    } else if (variantIds.has(variant.id)) {
      issues.push(issue(`${path}.id`, "Variant IDs must be unique within a product"));
    } else {
      variantIds.add(variant.id);
    }

    if (variant.active !== true) {
      issues.push(issue(`${path}.active`, "Variant is not active"));
    }
    if (!isRecord(variant.stockUnit) ||
        typeof variant.stockUnit.code !== "string" ||
        !UNIT_CODE.test(variant.stockUnit.code)) {
      issues.push(issue(`${path}.stockUnit`, "A controlled stock-unit code is required"));
    }
    const precisionValid = Number.isInteger(variant.quantityPrecision) &&
      variant.quantityPrecision >= 0 && variant.quantityPrecision <= 6;
    if (!precisionValid) {
      issues.push(issue(`${path}.quantityPrecision`, "Quantity precision must be an integer from 0 to 6"));
    }
    if (!Array.isArray(variant.sellingOptions) || variant.sellingOptions.length === 0) {
      issues.push(issue(`${path}.sellingOptions`, "At least one explicit selling option is required"));
      return;
    }

    const precision = precisionValid ? variant.quantityPrecision : 0;
    const optionIds = new Set();
    variant.sellingOptions.forEach((option, optionIndex) => {
      const optionPath = `${path}.sellingOptions[${optionIndex}]`;
      if (!isRecord(option)) {
        issues.push(issue(optionPath, "Selling option must be an object"));
        return;
      }
      if (typeof option.id !== "string" || !option.id.trim()) {
        issues.push(issue(`${optionPath}.id`, "Stable selling-option ID is required"));
      } else if (optionIds.has(option.id)) {
        issues.push(issue(`${optionPath}.id`, "Selling-option IDs must be unique within a variant"));
      } else {
        optionIds.add(option.id);
      }
      if (option.active !== true) {
        issues.push(issue(`${optionPath}.active`, "Selling option is not active"));
      }
      if (typeof option.unitCode !== "string" || !UNIT_CODE.test(option.unitCode)) {
        issues.push(issue(`${optionPath}.unitCode`, "A valid selling-unit code is required"));
      }
      if (typeof option.displayName !== "string" || !option.displayName.trim()) {
        issues.push(issue(`${optionPath}.displayName`, "Customer-facing selling-unit name is required"));
      }
      if (!safePositiveInteger(option.stockUnitsPerSaleUnit)) {
        issues.push(issue(`${optionPath}.stockUnitsPerSaleUnit`, "Explicit positive whole-number stock conversion is required"));
      }
      if (!validPositiveQuantity(option.minimumOrderQuantity, precision)) {
        issues.push(issue(`${optionPath}.minimumOrderQuantity`, "Minimum order quantity must be positive and within the variant quantity precision"));
      }
      if (!validPositiveQuantity(option.orderQuantityStep, precision)) {
        issues.push(issue(`${optionPath}.orderQuantityStep`, "Order quantity step must be positive and within the variant quantity precision"));
      }
      if (!Number.isSafeInteger(option.priceMinor) || option.priceMinor < 0) {
        issues.push(issue(`${optionPath}.priceMinor`, "Price must be a non-negative integer in minor currency units"));
      }
      if (option.promoPriceMinor !== undefined &&
          (!Number.isSafeInteger(option.promoPriceMinor) ||
           option.promoPriceMinor < 0 ||
           option.promoPriceMinor > option.priceMinor)) {
        issues.push(issue(`${optionPath}.promoPriceMinor`, "Promotional price must be between zero and the base price"));
      }
    });
  });

  return { valid: issues.length === 0, issues };
}

/** Resolve only stable IDs; never fall back to matching human-readable labels. */
export function resolveCheckoutSelection(product, variantId, sellingOptionId) {
  const validation = validateCheckoutProduct(product);
  if (!validation.valid) {
    const error = new Error("Product is not configured for trusted checkout");
    error.code = "CATALOGUE_NOT_READY";
    error.details = validation.issues;
    throw error;
  }

  const variant = product.variants.find(item => item.id === variantId);
  if (!variant) {
    const error = new Error("Selected product variant is unavailable");
    error.code = "VARIANT_UNAVAILABLE";
    throw error;
  }
  const sellingOption = variant.sellingOptions.find(item =>
    item.id === sellingOptionId && item.active === true
  );
  if (!sellingOption) {
    const error = new Error("Selected selling option is unavailable");
    error.code = "SELLING_OPTION_UNAVAILABLE";
    throw error;
  }
  return { variant, sellingOption };
}
