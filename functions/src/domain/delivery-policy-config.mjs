const ID=/^[A-Za-z0-9_.-]{1,128}$/;
const METHODS=new Set(["flat_per_order","per_selling_unit"]);
const money=value=>Number.isSafeInteger(value)&&value>=0;
export function validateDeliveryPolicyInput(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new TypeError("Delivery policy must be an object.");
 const allowed=["enabled","method","baseFeeMinor","optionFeesMinor","areas","expectedVersion"];
 const extra=Object.keys(input).find(k=>!allowed.includes(k));if(extra)throw new TypeError("Unsupported delivery policy field: "+extra);
 if(typeof input.enabled!=="boolean")throw new TypeError("enabled must be explicit.");
 if(!METHODS.has(input.method))throw new TypeError("Choose a supported delivery charging method.");
 if(!money(input.baseFeeMinor))throw new TypeError("Base fee must be a non-negative whole number of kobo.");
 if(!Array.isArray(input.areas)||input.areas.length>100)throw new TypeError("Areas must be a list of at most 100 entries.");
 const ids=new Set();
 const areas=input.areas.map((a,i)=>{
  if(!a||typeof a!=="object"||Array.isArray(a)||Object.keys(a).some(k=>!["id","label","feeMinor","active"].includes(k)))throw new TypeError("Area "+i+" has unsupported fields.");
  if(typeof a.id!=="string"||!ID.test(a.id)||ids.has(a.id))throw new TypeError("Area IDs must be unique stable IDs.");
  if(typeof a.label!=="string"||!a.label.trim()||a.label.trim().length>100)throw new TypeError("Area "+a.id+" needs a label.");
  if(!money(a.feeMinor)||typeof a.active!=="boolean")throw new TypeError("Area "+a.id+" has an invalid fee or active state.");
  ids.add(a.id);return {id:a.id,label:a.label.trim(),feeMinor:a.feeMinor,active:a.active};
 });
 let optionFeesMinor={};
 if(input.optionFeesMinor!==undefined){
  if(!input.optionFeesMinor||typeof input.optionFeesMinor!=="object"||Array.isArray(input.optionFeesMinor))throw new TypeError("Option fees must be an object keyed by selling-option ID.");
  for(const [id,fee] of Object.entries(input.optionFeesMinor)){if(!ID.test(id)||!money(fee))throw new TypeError("Selling-option fee is invalid.");optionFeesMinor[id]=fee;}
 }
 if(input.expectedVersion!==undefined&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0))throw new TypeError("expectedVersion must be a non-negative integer.");
 if(input.enabled&&areas.filter(a=>a.active).length===0)throw new TypeError("At least one active delivery area is required before enabling delivery.");
 return {enabled:input.enabled,method:input.method,baseFeeMinor:input.baseFeeMinor,optionFeesMinor,areas,expectedVersion:input.expectedVersion};
}
export function buildDeliveryPolicyDocument(input,version,updatedBy,nowMillis){
 const clean=validateDeliveryPolicyInput(input);
 return {schemaVersion:1,enabled:clean.enabled,version:"delivery-v"+version,versionNumber:version,method:clean.method,baseFeeMinor:clean.baseFeeMinor,optionFeesMinor:clean.optionFeesMinor,areas:clean.areas,zoneFeesMinor:Object.fromEntries(clean.areas.filter(a=>a.active).map(a=>[a.id,a.feeMinor])),updatedBy,updatedAtMillis:nowMillis};
}
export function deliveryPolicyForAdmin(doc){
 if(!doc)return {enabled:false,method:"flat_per_order",baseFeeMinor:0,optionFeesMinor:{},areas:[],versionNumber:0};
 return {enabled:doc.enabled===true,method:doc.method,baseFeeMinor:doc.baseFeeMinor,optionFeesMinor:doc.optionFeesMinor||{},areas:Array.isArray(doc.areas)?doc.areas:[],versionNumber:Number.isSafeInteger(doc.versionNumber)?doc.versionNumber:0};
}
