/**
 * Complete server-side checkout quote composition.
 * Quote only: no stock reservation or order creation occurs here.
 */
import { calculateMerchandiseQuote, validateCreateOrderRequest } from "./checkout.mjs";
import { calculateDeliveryCharge } from "./delivery-policy.mjs";

function safeMoneyTotal(...values) {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    const error = new Error("Calculated checkout total exceeds supported money range");
    error.code = "FAILED_PRECONDITION";
    throw error;
  }
  return Number(total);
}

export function calculateCheckoutQuote({ request, productsById, deliveryPolicy }) {
  const validated = validateCreateOrderRequest(request);
  const merchandise = calculateMerchandiseQuote(validated, productsById);
  const delivery = calculateDeliveryCharge({
    policy: deliveryPolicy,
    fulfilmentMethod: validated.fulfilment.method,
    areaId: validated.fulfilment.method === "delivery" ? validated.fulfilment.area : null,
    lines: merchandise.lines.map(line => ({
      sellingOptionId: line.sellingOptionId,
      quantity: line.quantity,
    })),
  });
  const grandTotalMinor = safeMoneyTotal(merchandise.merchandiseTotalMinor, delivery.deliveryFeeMinor);
  return {
    ...merchandise,
    deliveryFeeMinor: delivery.deliveryFeeMinor,
    grandTotalMinor,
    delivery,
    quoteStatus: "complete",
    checkoutReady: true,
  };
}
