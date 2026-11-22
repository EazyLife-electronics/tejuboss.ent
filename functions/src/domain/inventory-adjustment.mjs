const ID=/^[A-Za-z0-9_.-]{1,128}$/;
export function validatePhysicalCountAdjustment(input){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new TypeError("Adjustment must be an object.");
  const allowed=["balanceId","expectedQuantityOnHand","countedQuantity","reason","countConfirmed"];
  const extra=Object.keys(input).find(key=>!allowed.includes(key));
  if(extra)throw new TypeError("Unsupported field: "+extra);
  if(typeof input.balanceId!=="string"||!ID.test(input.balanceId))throw new TypeError("balanceId is invalid.");
  for(const key of ["expectedQuantityOnHand","countedQuantity"])
    if(!Number.isSafeInteger(input[key])||input[key]<0)throw new TypeError(key+" must be a non-negative whole number.");
  if(typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>240)throw new TypeError("A reason is required.");
  if(input.countConfirmed!==true)throw new TypeError("Confirm that this is a fresh physical count.");
  return {...input,reason:input.reason.trim()};
}
