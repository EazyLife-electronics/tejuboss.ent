/**
 * Guest-checkout request validation and trusted merchandise quote.
 *
 * No browser prices/totals are accepted. Delivery is intentionally excluded
 * until the existing delivery configuration has been mapped and revalidated.
 */

import { calculateCatalogueLinePrice } from "./order-pricing.mjs";

const MAX_LINES = 50;
const MAX_QUANTITY = 1_000_000;
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    fail("INVALID_ARGUMENT", `${field} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

/**
 * Public payload contract:
 * {
 *   idempotencyKey, items:[{productId,variantId,sellingOptionId,quantity}],
 *   customer:{name,phone,email?},
 *   fulfilment:{method:"delivery"|"pickup", address?, area?},
 *   note?
 * }
 */
export function validateCreateOrderRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_ARGUMENT", "Order request must be an object");
  }

  const allowedRoot = new Set([
    "idempotencyKey", "items", "customer", "fulfilment", "note"
  ]);
  const unexpected = Object.keys(input).filter(key => !allowedRoot.has(key));
  if (unexpected.length) {
    fail("INVALID_ARGUMENT", "Order request contains unsupported fields", { fields: unexpected });
  }

  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 128);
  if (!ID_PATTERN.test(idempotencyKey)) {
    fail("INVALID_ARGUMENT", "idempotencyKey contains unsupported characters");
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_LINES) {
    fail("INVALID_ARGUMENT", `Order must contain between 1 and ${MAX_LINES} item lines`);
  }

  const items = input.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail("INVALID_ARGUMENT", `items[${index}] must be an object`);
    }
    const allowed = new Set(["productId", "variantId", "sellingOptionId", "quantity"]);
    const extra = Object.keys(item).filter(key => !allowed.has(key));
    if (extra.length) {
      fail("INVALID_ARGUMENT", `items[${index}] contains unsupported fields`, { fields: extra });
    }
    for (const field of ["productId", "variantId", "sellingOptionId"]) {
      if (typeof item[field] !== "string" || !ID_PATTERN.test(item[field])) {
        fail("INVALID_ARGUMENT", `items[${index}].${field} is invalid`);
      }
    }
    if (typeof item.quantity !== "number" ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > MAX_QUANTITY) {
      fail("INVALID_ARGUMENT", `items[${index}].quantity is invalid`);
    }
    return {
      productId: item.productId,
      variantId: item.variantId,
      sellingOptionId: item.sellingOptionId,
      quantity: item.quantity
    };
  });

  if (!input.customer || typeof input.customer !== "object" || Array.isArray(input.customer)) {
    fail("INVALID_ARGUMENT", "Customer contact details are required");
  }
  const customerExtra = Object.keys(input.customer).filter(key =>
    !["name", "phone", "email"].includes(key)
  );
  if (customerExtra.length) {
    fail("INVALID_ARGUMENT", "Customer details contain unsupported fields", { fields: customerExtra });
  }
  const customer = {
    name: requiredText(input.customer.name, "customer.name", 120),
    phone: requiredText(input.customer.phone, "customer.phone", 32)
  };
  if (input.customer.email !== undefined && input.customer.email !== null && input.customer.email !== "") {
    customer.email = requiredText(input.customer.email, "customer.email", 254);
  }

  if (!input.fulfilment || typeof input.fulfilment !== "object" || Array.isArray(input.fulfilment)) {
    fail("INVALID_ARGUMENT", "Fulfilment selection is required");
  }
  const fulfilmentExtra = Object.keys(input.fulfilment).filter(key =>
    !["method", "address", "area"].includes(key)
  );
  if (fulfilmentExtra.length) {
    fail("INVALID_ARGUMENT", "Fulfilment details contain unsupported fields", { fields: fulfilmentExtra });
  }
  const method = input.fulfilment.method;
  if (!["delivery", "pickup"].includes(method)) {
    fail("INVALID_ARGUMENT", "Fulfilment method must be delivery or pickup");
  }
  const fulfilment = { method };
  if (method === "delivery") {
    fulfilment.address = requiredText(input.fulfilment.address, "fulfilment.address", 500);
    fulfilment.area = requiredText(input.fulfilment.area, "fulfilment.area", 120);
  }

  const note = input.note === undefined || input.note === null
    ? ""
    : typeof input.note === "string" && input.note.trim().length <= 1000
      ? input.note.trim()
      : fail("INVALID_ARGUMENT", "note must be a string of at most 1000 characters");
  return { idempotencyKey, items, customer, fulfilment, note };
}

/**
 * Build a merchandise-only quote from trusted catalogue documents.
 * productsById maps Firestore document IDs to document data. Unknown IDs fail
 * closed. Callers must load current published products from the trusted server.
 */
export function calculateMerchandiseQuote(request, productsById) {
  const validated = validateCreateOrderRequest(request);
  if (!(productsById instanceof Map)) {
    throw new TypeError("productsById must be a Map of trusted catalogue documents");
  }

  const lines = validated.items.map(item => {
    const product = productsById.get(item.productId);
    if (!product) {
      fail("PRODUCT_UNAVAILABLE", "One or more selected products are unavailable", {
        productId: item.productId
      });
    }
    return calculateCatalogueLinePrice({
      product,
      productId: item.productId,
      variantId: item.variantId,
      sellingOptionId: item.sellingOptionId,
      quantity: item.quantity
    });
  });

  const subtotalBig = lines.reduce((sum, line) => sum + BigInt(line.subtotalMinor), 0n);
  const discountBig = lines.reduce((sum, line) => sum + BigInt(line.discountMinor), 0n);
  const totalBig = lines.reduce((sum, line) => sum + BigInt(line.totalMinor), 0n);
  for (const [name, value] of [["subtotal", subtotalBig], ["discount", discountBig], ["total", totalBig]]) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("FAILED_PRECONDITION", `Calculated ${name} exceeds supported money range`);
    }
  }

  return {
    currency: "NGN",
    lines,
    subtotalMinor: Number(subtotalBig),
    discountMinor: Number(discountBig),
    merchandiseTotalMinor: Number(totalBig),
    deliveryFeeMinor: null,
    grandTotalMinor: null,
    quoteStatus: "merchandise_only_delivery_pending",
    checkoutReady: false,
    customer: validated.customer,
    fulfilment: validated.fulfilment,
    note: validated.note,
    idempotencyKey: validated.idempotencyKey
  };
}
