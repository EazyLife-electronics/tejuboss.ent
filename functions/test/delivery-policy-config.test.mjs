import test from "node:test";
import assert from "node:assert/strict";
import {validateDeliveryPolicyInput,buildDeliveryPolicyDocument,deliveryPolicyForAdmin} from "../src/domain/delivery-policy-config.mjs";
const base={enabled:true,method:"flat_per_order",baseFeeMinor:50000,optionFeesMinor:{},areas:[{id:"ibadan_southwest",label:"Ibadan Southwest",feeMinor:10000,active:true}],expectedVersion:0};
test("validates explicit delivery method, stable areas and integer kobo",()=>{const x=validateDeliveryPolicyInput(base);assert.equal(x.areas[0].id,"ibadan_southwest");});
test("requires an active area before enabling delivery",()=>{assert.throws(()=>validateDeliveryPolicyInput({...base,areas:[{...base.areas[0],active:false}]}),/active delivery area/);});
test("rejects duplicate IDs, malformed fees and unexpected fields",()=>{assert.throws(()=>validateDeliveryPolicyInput({...base,areas:[...base.areas,...base.areas]}),/unique stable IDs/);assert.throws(()=>validateDeliveryPolicyInput({...base,baseFeeMinor:1.2}),/whole number of kobo/);assert.throws(()=>validateDeliveryPolicyInput({...base,secret:"x"}),/Unsupported/);});
test("builds a versioned checkout-compatible document and admin projection",()=>{const doc=buildDeliveryPolicyDocument(base,3,"staff1",123);assert.equal(doc.version,"delivery-v3");assert.deepEqual(doc.zoneFeesMinor,{ibadan_southwest:10000});assert.equal(deliveryPolicyForAdmin(doc).versionNumber,3);});
test("disabled policy can be saved without areas while checkout remains disabled",()=>{const doc=buildDeliveryPolicyDocument({...base,enabled:false,areas:[]},1,"staff1",123);assert.equal(doc.enabled,false);assert.deepEqual(doc.zoneFeesMinor,{});});
