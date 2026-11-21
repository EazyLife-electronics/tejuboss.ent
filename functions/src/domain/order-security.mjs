import { createHash, randomBytes } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function buildIdempotencyRecord({ scopeId, idempotencyKey, payload }) {
  if (typeof scopeId !== "string" || !scopeId.trim()) throw new TypeError("scopeId is required");
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) throw new TypeError("idempotencyKey is required");
  const keyHash = sha256("tejuboss:idempotency:v1:" + scopeId + ":" + idempotencyKey);
  const requestFingerprint = sha256(stable(payload));
  return { keyHash, requestFingerprint };
}

export function inspectIdempotencyReplay(existing, candidate) {
  if (!existing) return { outcome: "new" };
  if (existing.requestFingerprint !== candidate.requestFingerprint) return { outcome: "conflict" };
  if (existing.status === "completed" && existing.orderId) return { outcome: "replay", orderId: existing.orderId };
  if (existing.status === "processing") return { outcome: "in_progress" };
  return { outcome: "retry" };
}

export function createTrackingCredential() {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: sha256("tejuboss:tracking:v1:" + rawToken) };
}

export function hashTrackingCredential(rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 32 || rawToken.length > 256) {
    throw new TypeError("Tracking token is invalid");
  }
  return sha256("tejuboss:tracking:v1:" + rawToken);
}
