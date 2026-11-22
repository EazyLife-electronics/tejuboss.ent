/** Public-safe delivery choices. Never expose staff notes or actor metadata. */
export function toPublicDeliveryOptions(policy) {
  if (!policy || policy.enabled !== true ||
      !["flat_per_order", "per_selling_unit"].includes(policy.method) ||
      !Number.isSafeInteger(policy.baseFeeMinor) || policy.baseFeeMinor < 0) {
    return { enabled: false, method: null, baseFeeMinor: 0, areas: [] };
  }
  const areas = Array.isArray(policy.areas) ? policy.areas
    .filter(area => area && area.active === true &&
      typeof area.id === "string" && typeof area.label === "string" &&
      Number.isSafeInteger(area.feeMinor) && area.feeMinor >= 0)
    .map(area => ({ id: area.id, label: area.label, feeMinor: area.feeMinor })) : [];
  return { enabled: areas.length > 0, method: policy.method, baseFeeMinor: policy.baseFeeMinor, areas };
}
