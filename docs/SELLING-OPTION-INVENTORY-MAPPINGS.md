# Selling-option inventory mappings

Status: Guarded callable and pure input validation added on the foundation branch. Not deployed.

Each active selling option maps by stable IDs to one physically initialized stock balance. The server derives the mapping ID from product, variant and selling-option IDs, then independently verifies the current published catalogue conversion, inventory form and balance.

Optional loose-stock fallback requires a separately counted sealed-package balance at the same product, variant and location. The declared package size must match the sealed form's canonical conversion. No balance quantity is changed when a mapping is saved.

Mappings can be replaced by an authorized inventory manager; every change is audited. App Check and the owner/inventory_manager custom claim are required. No customer client can write these records directly.
