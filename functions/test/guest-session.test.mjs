import test from "node:test";
import assert from "node:assert/strict";
import {
  createGuestSessionCredential,
  hashGuestSessionCredential,
  isGuestSessionRecordValid,
} from "../src/domain/guest-session.mjs";

test("creates a random credential and persists only its hash metadata", () => {
  const a = createGuestSessionCredential({ now: 1000, lifetimeMs: 60000 });
  const b = createGuestSessionCredential({ now: 1000, lifetimeMs: 60000 });
  assert.notEqual(a.rawToken, b.rawToken);
  assert.equal(a.tokenHash, hashGuestSessionCredential(a.rawToken));
  assert.equal(a.scopeId, a.tokenHash);
  assert.equal(a.createdAtMillis, 1000);
  assert.equal(a.expiresAtMillis, 61000);
  assert.equal(a.tokenHash.length, 64);
});

test("validates the correct token only within its active lifetime", () => {
  const session = createGuestSessionCredential({ now: 1000, lifetimeMs: 5000 });
  const record = {
    tokenHash: session.tokenHash,
    createdAtMillis: session.createdAtMillis,
    expiresAtMillis: session.expiresAtMillis,
  };
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record, now: 1000 }), true);
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record, now: 5999 }), true);
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record, now: 6000 }), false);
  assert.equal(isGuestSessionRecordValid({ rawToken: "wrong-token-value-that-is-long-enough-123", record, now: 2000 }), false);
});

test("rejects revoked, malformed and future-dated session records", () => {
  const session = createGuestSessionCredential({ now: 1000, lifetimeMs: 5000 });
  const base = {
    tokenHash: session.tokenHash,
    createdAtMillis: session.createdAtMillis,
    expiresAtMillis: session.expiresAtMillis,
  };
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record: { ...base, revokedAtMillis: 2000 }, now: 2000 }), false);
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record: base, now: 999 }), false);
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record: { ...base, expiresAtMillis: 999999999 }, now: 2000 }), false);
  assert.equal(isGuestSessionRecordValid({ rawToken: session.rawToken, record: null, now: 2000 }), false);
});

test("rejects invalid credential and unsafe session lifetimes", () => {
  assert.throws(() => hashGuestSessionCredential("short"), /invalid/);
  assert.throws(() => createGuestSessionCredential({ lifetimeMs: 0 }), /between 1 ms and 24 hours/);
  assert.throws(() => createGuestSessionCredential({ lifetimeMs: 86400001 }), /between 1 ms and 24 hours/);
  assert.throws(
    () => createGuestSessionCredential({ now: Number.MAX_SAFE_INTEGER, lifetimeMs: 1 }),
    /safe timestamp range/
  );
});
