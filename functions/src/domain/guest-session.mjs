import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const MAX_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Create a high-entropy guest checkout credential.
 * Persist only tokenHash and timestamps. Return rawToken to the browser once.
 */
export function createGuestSessionCredential({
  now = Date.now(),
  lifetimeMs = 2 * 60 * 60 * 1000,
} = {}) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("now must be a non-negative safe integer timestamp");
  }
  if (!Number.isSafeInteger(lifetimeMs) ||
      lifetimeMs <= 0 ||
      lifetimeMs > MAX_SESSION_LIFETIME_MS) {
    throw new RangeError("Guest session lifetime must be between 1 ms and 24 hours");
  }

  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = sha256(rawToken);
  return {
    rawToken,
    tokenHash,
    scopeId: tokenHash,
    createdAtMillis: now,
    expiresAtMillis: now + lifetimeMs,
  };
}

export function hashGuestSessionCredential(rawToken) {
  if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(rawToken)) {
    throw new TypeError("Guest session credential is invalid");
  }
  return sha256(rawToken);
}

/**
 * Validate a session using only its hash-keyed server-side record.
 * The record must never be readable or writable by public clients.
 */
export function isGuestSessionRecordValid({
  rawToken,
  record,
  now = Date.now(),
}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (!Number.isSafeInteger(now) || now < 0) return false;
  if (!Number.isSafeInteger(record.createdAtMillis) ||
      !Number.isSafeInteger(record.expiresAtMillis) ||
      record.expiresAtMillis <= record.createdAtMillis ||
      record.expiresAtMillis - record.createdAtMillis > MAX_SESSION_LIFETIME_MS ||
      now < record.createdAtMillis ||
      now >= record.expiresAtMillis ||
      record.revokedAtMillis !== undefined) {
    return false;
  }

  let candidate;
  try {
    candidate = Buffer.from(hashGuestSessionCredential(rawToken), "hex");
  } catch {
    return false;
  }
  if (typeof record.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash)) {
    return false;
  }
  const expected = Buffer.from(record.tokenHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
