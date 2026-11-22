import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { listCommerceOrderArchive } from "../src/order-archive.mjs";

const projectId = "tejuboss-rules-test";
let app, db;
const call = (fn, data, auth) => fn.run({ data, auth });

before(async () => { app = initializeApp({ projectId }); db = getFirestore(app); });
after(async () => { await deleteApp(app); });

test("archive date range, completed/rejected filtering, paging cursor and payment-role redaction", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const base = Date.now() - 10000;
  const refs = [
    { id: "archive-complete-" + suffix, status: "confirmed", fulfilmentStatus: "fulfilled", createdAtMillis: base + 1 },
    { id: "archive-reject-" + suffix, status: "rejected", fulfilmentStatus: "unfulfilled", createdAtMillis: base + 2 },
    { id: "archive-active-" + suffix, status: "confirmed", fulfilmentStatus: "preparing", createdAtMillis: base + 3 },
    { id: "archive-outside-" + suffix, status: "rejected", fulfilmentStatus: "unfulfilled", createdAtMillis: base + 4 }
  ].map(d => db.collection("orders").doc(d.id));
  const docs = [
    { status: "confirmed", fulfilmentStatus: "fulfilled", createdAtMillis: base + 1 },
    { status: "rejected", fulfilmentStatus: "unfulfilled", createdAtMillis: base + 2 },
    { status: "confirmed", fulfilmentStatus: "preparing", createdAtMillis: base + 3 },
    { status: "rejected", fulfilmentStatus: "unfulfilled", createdAtMillis: base + 4 }
  ];
  const batch = db.batch();
  refs.forEach((ref, i) => batch.set(ref, {
    ...docs[i], customer: { name: "Archive Buyer", phone: "08000000000" },
    fulfilment: { method: "delivery", area: "Ibadan" },
    lines: [{ productName: "Sample rice", quantity: 2 }],
    grandTotalMinor: 70000, paymentTotalMinor: 30000, paymentStatus: "partially_paid"
  }));
  await batch.commit();
  try {
    const owner = { uid: "archive-owner", token: { role: "owner" } };
    const result = await call(listCommerceOrderArchive, {
      fromMillis: base, toMillis: base + 3
    }, owner);
    assert.deepEqual(new Set(result.orders.map(o => o.id)), new Set([refs[0].id, refs[1].id]));
    assert.equal(result.orders.some(o => o.id === refs[2].id), false);
    assert.equal(result.orders.some(o => o.id === refs[3].id), false);
    assert.equal(result.orders[0].customer.name, "Archive Buyer");
    const payment = await call(listCommerceOrderArchive, {
      fromMillis: base, toMillis: base + 3
    }, { uid: "archive-pay", token: { role: "payment_manager" } });
    assert.equal(payment.privacyLimited, true);
    assert.equal(payment.orders[0].customer.name, undefined);
    assert.equal(payment.orders[0].fulfilment.area, undefined);
    await assert.rejects(call(listCommerceOrderArchive, {
      fromMillis: base, toMillis: base + 3
    }, { uid: "archive-inventory", token: { role: "inventory_manager" } }), e => e.code === "permission-denied");
    await assert.rejects(call(listCommerceOrderArchive, {
      fromMillis: base, toMillis: base + 91 * 24 * 60 * 60 * 1000
    }, owner), e => e.code === "invalid-argument");
  } finally {
    const cleanup = db.batch();
    refs.forEach(ref => cleanup.delete(ref));
    await cleanup.commit();
  }
});
