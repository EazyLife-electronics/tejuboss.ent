import test from "node:test";
import assert from "node:assert/strict";
import { planOrderDecision } from "../src/domain/order-lifecycle.mjs";

test("order placement does not deduct stock; confirmation does", () => {
  const decision = planOrderDecision({
    currentStatus: "awaiting_confirmation",
    decision: "confirm"
  });
  assert.equal(decision.nextStatus, "confirmed");
  assert.equal(decision.deductInventory, true);
  assert.equal(decision.inventoryAction, "deduct");
});

test("rejecting an unconfirmed order does not deduct stock", () => {
  const decision = planOrderDecision({
    currentStatus: "awaiting_confirmation",
    decision: "reject"
  });
  assert.equal(decision.nextStatus, "rejected");
  assert.equal(decision.deductInventory, false);
});

test("repeated confirmation is idempotent and must not deduct twice", () => {
  const decision = planOrderDecision({
    currentStatus: "confirmed",
    decision: "confirm"
  });
  assert.equal(decision.outcome, "already_applied");
  assert.equal(decision.deductInventory, false);
});

test("cannot confirm rejected or cancelled orders", () => {
  for (const currentStatus of ["rejected", "cancelled", "fulfilled"]) {
    assert.throws(
      () => planOrderDecision({ currentStatus, decision: "confirm" }),
      error => error.code === "FAILED_PRECONDITION"
    );
  }
});

test("unknown states and actions fail closed", () => {
  assert.throws(() => planOrderDecision({ currentStatus: "draft", decision: "confirm" }));
  assert.throws(() => planOrderDecision({ currentStatus: "awaiting_confirmation", decision: "ship" }));
});
