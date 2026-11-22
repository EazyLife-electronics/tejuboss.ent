import test from "node:test";
import assert from "node:assert/strict";
import { toPublicDeliveryOptions } from "../src/domain/public-delivery-options.mjs";

test("public delivery projection includes only active customer choices", () => {
  const result = toPublicDeliveryOptions({
    enabled: true, method: "flat_per_order", baseFeeMinor: 250000,
    updatedBy: "staff-secret", internalNote: "private",
    areas: [
      { id: "ibadan-central", label: "Ibadan Central", feeMinor: 50000, active: true, staffNote: "secret" },
      { id: "inactive", label: "Inactive", feeMinor: 0, active: false }
    ]
  });
  assert.deepEqual(result, {
    enabled: true, method: "flat_per_order", baseFeeMinor: 250000,
    areas: [{ id: "ibadan-central", label: "Ibadan Central", feeMinor: 50000 }]
  });
  assert.equal("updatedBy" in result, false);
  assert.equal("internalNote" in result, false);
});

test("disabled or incomplete policy returns delivery unavailable", () => {
  assert.deepEqual(toPublicDeliveryOptions(null), { enabled: false, method: null, baseFeeMinor: 0, areas: [] });
  assert.deepEqual(toPublicDeliveryOptions({ enabled: true, method: "flat_per_order", baseFeeMinor: 0, areas: [] }),
    { enabled: false, method: "flat_per_order", baseFeeMinor: 0, areas: [] });
});
