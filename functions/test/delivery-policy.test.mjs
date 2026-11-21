import test from "node:test";
import assert from "node:assert/strict";
import { calculateDeliveryCharge } from "../src/domain/delivery-policy.mjs";

const policy = {
  enabled: true,
  version: "delivery-v1",
  method: "per_selling_unit",
  baseFeeMinor: 75000,
  optionFeesMinor: { carton: 120000 },
  zoneFeesMinor: { ibadan_southwest: 20000 },
};

test("calculates per-selling-unit fees with option override and zone fee", () => {
  const result = calculateDeliveryCharge({
    policy,
    fulfilmentMethod: "delivery",
    areaId: "ibadan_southwest",
    lines: [
      { sellingOptionId: "piece", quantity: 2 },
      { sellingOptionId: "carton", quantity: 1 },
    ],
  });
  assert.equal(result.deliveryFeeMinor, 290000);
  assert.equal(result.lineFeesMinor, 270000);
  assert.equal(result.zoneFeeMinor, 20000);
  assert.equal(result.policyVersion, "delivery-v1");
});

test("flat per order charges the base fee once, not once per line", () => {
  const result = calculateDeliveryCharge({
    policy: { ...policy, method: "flat_per_order", baseFeeMinor: 50000 },
    fulfilmentMethod: "delivery",
    lines: [
      { sellingOptionId: "piece", quantity: 10 },
      { sellingOptionId: "carton", quantity: 2 },
    ],
  });
  assert.equal(result.deliveryFeeMinor, 50000);
});

test("pickup is always free even when product delivery fees exist", () => {
  const result = calculateDeliveryCharge({
    policy,
    fulfilmentMethod: "pickup",
    lines: [{ sellingOptionId: "carton", quantity: 1 }],
  });
  assert.equal(result.deliveryFeeMinor, 0);
  assert.equal(result.calculationMethod, "pickup");
});

test("rejects disabled, missing, unsupported and malformed policies", () => {
  assert.throws(() => calculateDeliveryCharge({
    policy: { ...policy, enabled: false },
    fulfilmentMethod: "delivery",
    lines: [{ sellingOptionId: "piece", quantity: 1 }],
  }), /DELIVERY_POLICY_UNAVAILABLE/);
  assert.throws(() => calculateDeliveryCharge({
    policy: { ...policy, method: "legacy_cascade" },
    fulfilmentMethod: "delivery",
    lines: [{ sellingOptionId: "piece", quantity: 1 }],
  }), /DELIVERY_METHOD_NOT_SUPPORTED/);
  assert.throws(() => calculateDeliveryCharge({
    policy,
    fulfilmentMethod: "delivery",
    lines: [{ sellingOptionId: "piece", quantity: 1 }],
  }), /DELIVERY_AREA_REQUIRED/);
  assert.throws(() => calculateDeliveryCharge({
    policy,
    fulfilmentMethod: "delivery",
    areaId: "unknown",
    lines: [{ sellingOptionId: "piece", quantity: 1 }],
  }), /DELIVERY_AREA_UNSUPPORTED/);
  assert.throws(() => calculateDeliveryCharge({
    policy,
    fulfilmentMethod: "delivery",
    lines: [{ sellingOptionId: "piece", quantity: 0 }],
  }), /positive finite number/);
});

test("results do not depend on cart line ordering", () => {
  const lines = [
    { sellingOptionId: "piece", quantity: 2 },
    { sellingOptionId: "carton", quantity: 1 },
  ];
  const a = calculateDeliveryCharge({ policy, fulfilmentMethod: "delivery", areaId: "ibadan_southwest", lines });
  const b = calculateDeliveryCharge({ policy, fulfilmentMethod: "delivery", areaId: "ibadan_southwest", lines: [...lines].reverse() });
  assert.equal(a.deliveryFeeMinor, b.deliveryFeeMinor);
});
