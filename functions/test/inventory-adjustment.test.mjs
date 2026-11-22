import test from "node:test";
import assert from "node:assert/strict";
import { validatePhysicalCountAdjustment } from "../src/domain/inventory-adjustment.mjs";
const valid={balanceId:"balance_1",expectedQuantityOnHand:12,countedQuantity:9,reason:"Cycle count",countConfirmed:true};
test("accepts confirmed physical count with explicit expected balance",()=>{assert.equal(validatePhysicalCountAdjustment(valid).countedQuantity,9);});
test("requires fresh count confirmation and reason",()=>{assert.throws(()=>validatePhysicalCountAdjustment({...valid,countConfirmed:false}));assert.throws(()=>validatePhysicalCountAdjustment({...valid,reason:""}));});
test("rejects stale/invalid quantities and extra fields",()=>{assert.throws(()=>validatePhysicalCountAdjustment({...valid,expectedQuantityOnHand:-1}));assert.throws(()=>validatePhysicalCountAdjustment({...valid,countedQuantity:1.5}));assert.throws(()=>validatePhysicalCountAdjustment({...valid,price:2}));});
