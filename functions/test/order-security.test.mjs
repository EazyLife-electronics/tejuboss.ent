import test from "node:test";
import assert from "node:assert/strict";
import { buildIdempotencyRecord, inspectIdempotencyReplay, createTrackingCredential, hashTrackingCredential } from "../src/domain/order-security.mjs";

test("idempotency record is stable for same scope, key and payload", () => {
  const a = buildIdempotencyRecord({ scopeId: "guest-session-1", idempotencyKey: "cart-submit-001", payload: { items: [{ productId: "p1", quantity: 2 }], customer: { name: "Ada" } } });
  const b = buildIdempotencyRecord({ scopeId: "guest-session-1", idempotencyKey: "cart-submit-001", payload: { customer: { name: "Ada" }, items: [{ quantity: 2, productId: "p1" }] } });
  assert.deepEqual(a, b);
  assert.equal(a.keyHash.includes("cart-submit-001"), false);
});

test("idempotency keys are isolated by server-derived scope", () => {
  const a = buildIdempotencyRecord({ scopeId: "guest-a", idempotencyKey: "same", payload: { x: 1 } });
  const b = buildIdempotencyRecord({ scopeId: "guest-b", idempotencyKey: "same", payload: { x: 1 } });
  assert.notEqual(a.keyHash, b.keyHash);
});

test("replay detection distinguishes new, replay, conflict and in-progress", () => {
  const candidate = { requestFingerprint: "fp-1" };
  assert.deepEqual(inspectIdempotencyReplay(null, candidate), { outcome: "new" });
  assert.deepEqual(inspectIdempotencyReplay({ requestFingerprint: "fp-1", status: "completed", orderId: "o1" }, candidate), { outcome: "replay", orderId: "o1" });
  assert.deepEqual(inspectIdempotencyReplay({ requestFingerprint: "fp-2", status: "completed", orderId: "o1" }, candidate), { outcome: "conflict" });
  assert.deepEqual(inspectIdempotencyReplay({ requestFingerprint: "fp-1", status: "processing" }, candidate), { outcome: "in_progress" });
});

test("tracking credential is random and its persisted hash verifies", () => {
  const a = createTrackingCredential();
  const b = createTrackingCredential();
  assert.notEqual(a.rawToken, b.rawToken);
  assert.notEqual(a.tokenHash, b.tokenHash);
  assert.equal(hashTrackingCredential(a.rawToken), a.tokenHash);
  assert.equal(a.tokenHash.includes(a.rawToken), false);
});

test("tracking hash rejects short tokens", () => {
  assert.throws(() => hashTrackingCredential("short"), /invalid/i);
});
