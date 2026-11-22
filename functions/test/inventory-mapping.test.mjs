import test from "node:test";import assert from "node:assert/strict";import {inventoryMappingDocumentId,validateInventoryMappingInput} from "../src/domain/inventory-mapping.mjs";
const v={productId:"p1",variantId:"v1",sellingOptionId:"piece",locationId:"ibadan_main",inventoryFormId:"loose"};
test("mapping ID is stable and unique per selling option",()=>{assert.equal(inventoryMappingDocumentId(v),inventoryMappingDocumentId({...v}));assert.notEqual(inventoryMappingDocumentId(v),inventoryMappingDocumentId({...v,sellingOptionId:"carton"}));});
test("validates explicit sealed fallback",()=>{assert.equal(validateInventoryMappingInput({...v,sealedInventoryFormId:"carton",unitsPerPackage:48}).unitsPerPackage,48);assert.throws(()=>validateInventoryMappingInput({...v,sealedInventoryFormId:"carton"}));assert.throws(()=>validateInventoryMappingInput({...v,unitsPerPackage:48}));});
test("rejects unknown fields",()=>assert.throws(()=>validateInventoryMappingInput({...v,price:100})));
