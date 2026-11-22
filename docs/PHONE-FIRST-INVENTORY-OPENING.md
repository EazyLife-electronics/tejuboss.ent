# Phone-first inventory opening counts

Status: Backend callable and pure validation added on the foundation branch. Not deployed.

## Safe first count
1. Select a published structured product and active variant.
2. Create a stable inventory form, such as loose piece, sealed pack or carton. Specify its stock-unit code and conversion to the variant's canonical stock unit.
3. Select the launch location.
4. Enter the physically counted quantity, a short reason, and affirm the count.
5. The callable creates a balance only if that exact product/variant/location/form balance does not already exist. It never overwrites an existing count.
6. Every opening count is audited. Zero is a valid counted balance; guessed values are not.

The balance ID is a server-derived SHA-256 of stable product, variant, location and form IDs. Reusing a form ID with different unit settings is rejected.

## Boundary
This callable initializes balances only. Selling-option mapping, count adjustments and phone UI remain next. It requires App Check and an owner/inventory_manager custom claim. These have not been provisioned or deployed. Legacy product stock fields are not modified.
