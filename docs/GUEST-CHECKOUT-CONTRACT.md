# Guest Checkout Request and Merchandise Quote Contract

Status: Implemented as a pure, tested domain boundary. Not connected to Firestore and does not create orders.

## Request

The public request accepts only:
- idempotency key;
- product document ID, stable variant ID, stable selling-option ID and quantity per line;
- customer name and phone, optional email;
- fulfilment method and delivery address/area when delivery is selected;
- optional customer note.

It rejects client-supplied prices, discounts, stock quantities, delivery fees, subtotals and totals. It also rejects unknown fields rather than silently trusting them.

Guest checkout does not require an account.

## Quote

`calculateMerchandiseQuote` receives validated request data and trusted catalogue documents loaded by a backend caller. It calculates line prices and merchandise subtotal/discount/total from the catalogue. It returns a deliberately non-final quote:
- `deliveryFeeMinor: null`
- `grandTotalMinor: null`
- `checkoutReady: false`

This is intentional. Existing delivery settings and fee logic must be audited and migrated before a complete amount can be accepted. Quantity tiers are also not applied until the commercial tier calculation mode and configuration are finalized.

## Not yet implemented

This module does not create an order, reserve or deduct stock, issue tracking credentials, or commit a Firestore transaction. Those actions require the final inventory-balance key and inventory-form mapping, idempotency storage, delivery configuration, and actual product record samples. No live Firebase reads or writes are performed.
