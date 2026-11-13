# Barcode Labels Backend

Endpoints the Barcode Labels page uses to find what to label and turn a print queue into label rows. This is Stage 2 of the unit barcode labels work; Stage 1 added `product_units.unit_code` and POS scanning by unit code ([used-phones.md](./used-phones.md#unit-codes)).

**Status:** the backend is complete. The Barcode Labels page (`frontend/src/pages/BarcodeLabels`) does not use these endpoints yet: that is Stage 3. Until then the page still builds labels in the browser from `GET /products` and `GET /product-units`. It encodes the raw IMEI or serial number and can print a cost price, which these endpoints never do. `test/barcode-labels.e2e-spec.ts` has not been executed yet.

Code: `backend/src/barcode-labels/`.

## Two kinds of label

| Kind | For | Barcode encodes | Readable text | Price |
|---|---|---|---|---|
| `PRODUCT` | Active `QUANTITY`-tracked products | The product's `barcode` (such as `SLP-000123`) | Name, SKU | The product's `selling_price` |
| `UNIT` | One `IN_STOCK` unit of an active `IMEI` or `SERIAL_NUMBER` product | The unit's `unit_code` (such as `SLU00000123`) | The real IMEI or serial number | The unit's `selling_price`, else the product's |

- **A unit label never encodes the IMEI or serial number.** The till's `GET /product-units/sellable/by-identifier/:identifier` resolves the scanned `unit_code` to that exact unit and sells it by its real identifier. Product labels go through the till's existing `GET /products/by-barcode/:barcode`. Neither lookup has changed.
- **`identifier` follows the sale's choice.** It is the identifier a sale would record for the unit (`unitSaleIdentifier`): the IMEI for an IMEI product, the serial number for a serial product, and the other one when only that exists. Units recorded before `imei_number` and `serial_number` existed fall back to the legacy `imei` column. `identifier_type` (`IMEI` or `SERIAL_NUMBER`) says which it is, as the till's lookup does: phone labels print the IMEI, other labels the serial number.
- **Prices** are decimal strings, as elsewhere in the API (`"4500.00"`), and `null` when none is set; the label then prints without a price.
- **No cost, ever.** No response carries `buying_price` or any other cost field, for any role. No customer, sale or sale line is joined either. Rows are built field by field from columns selected by name, never entities, so the response doesn't depend on the serializer's cost rule (`@ExposeCost`, which only covers entities).

## Access

- **Admins and managers only**, set once on `BarcodeLabelsController` with `@Roles(ADMIN, MANAGER)`; no route sets its own. Cashiers get 403, and requests without a session get 401.
- **Units are branch-scoped** with `scopeBranch`, as `GET /product-units` is:
  - Admins see every branch, or the one given in `branchId`.
  - Managers see only their own branch, whether `branchId` is left out or is their own. Another `branchId` is 403 `{ message, code: 'WRONG_BRANCH' }`.
  - In the queue, a unit at another branch gets the same `UNIT_NOT_FOUND` as an unknown one, so neither its existence nor its status is revealed.
- **Products are not branch-specific**: the catalogue is shared, as `GET /products` is, so the product search has no `branchId`.

All three endpoints are read-only: nothing is saved, changed or audited.

## `GET /api/v1/barcode-labels/products`

Active `QUANTITY`-tracked products, for product-level labels. IMEI and serial products are left out: they get unit labels. Soft-deleted products are left out too.

**Query:**

| Param | Rules |
|---|---|
| `search` | Optional. Part of the name, SKU or barcode, in any case. Trimmed; empty or whitespace-only is ignored; otherwise 2–100 characters. `%`, `_` and `\` match themselves. |
| `page` | Whole number, at least 1. Default 1. |
| `limit` | Whole number, 1–200. Default 50. |

Any other parameter is a 400. Sorted by `created_at DESC, id DESC`, as `GET /products` is.

**Response (200):** `ProductLabelSearchResponseDto`

```json
{
  "data": [
    {
      "kind": "PRODUCT",
      "product_id": "uuid",
      "name": "USB-C Charger 20W",
      "model": "PD-20",
      "sku": "SKU-000123",
      "barcode": "SLP-000123",
      "barcode_type": "CODE_128",
      "selling_price": "4500.00"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 50, "totalPages": 1, "hasNext": false, "hasPrev": false }
}
```

`model` and `selling_price` may be `null`. `barcode_type` is `CODE_128` or `EAN_13`.

**Errors:** 400 invalid query, 401, 403.

## `GET /api/v1/barcode-labels/units`

The units that may get a label now: `IN_STOCK` units of active `IMEI`- or `SERIAL_NUMBER`-tracked products. That is the same rule as the till's sellable lookup, so a printed label scans. Sold, returned, written-off and inspection units are left out.

**Query:**

| Param | Rules |
|---|---|
| `search` | Optional. Part of the IMEI, legacy `imei` column, serial number, unit code, or the product's SKU or name, in any case. Same trimming and 2–100 rule as above; `%`, `_` and `\` match themselves. |
| `branchId` | Optional UUID. Branch scoping as above. |
| `productId` | Optional UUID: units of one product. |
| `page`, `limit` | As above. |

Sorted by `created_at DESC, id DESC`. Only the product and branch are joined, so each row is one unit.

**Response (200):** `UnitLabelSearchResponseDto`

```json
{
  "data": [
    {
      "kind": "UNIT",
      "unit_id": "uuid",
      "unit_code": "SLU00000123",
      "product_id": "uuid",
      "name": "iPhone 13 128GB",
      "tracking_method": "IMEI",
      "identifier_type": "IMEI",
      "identifier": "356938035643809",
      "selling_price": "185000.00",
      "branch": { "id": "uuid", "name": "Main Shop" }
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 50, "totalPages": 1, "hasNext": false, "hasPrev": false }
}
```

`tracking_method` and `identifier_type` are each `IMEI` or `SERIAL_NUMBER`. `selling_price` may be `null`.

**Errors:** 400 invalid query (including a malformed `branchId` or `productId`), 401, 403 (a cashier, or `WRONG_BRANCH`).

## `POST /api/v1/barcode-labels/resolve`

Checks a whole print queue and returns its label rows in the order sent. Returns 200, not 201: nothing is created.

**Request:** `ResolveLabelQueueDto`

```json
{
  "branchId": "uuid",
  "items": [
    { "type": "PRODUCT", "productId": "uuid", "quantity": 2 },
    { "type": "UNIT", "unitId": "uuid" },
    { "type": "UNIT", "unitId": "uuid" }
  ]
}
```

- `branchId`: optional UUID, the branch whose units may be printed. Branch scoping as above; products ignore it.
- `items`: 1–500 entries, in print order. Each is a `LabelQueueItemDto`:
  - `PRODUCT`: `productId` (UUID) and `quantity` (a whole number, 1–500) are required. `unitId` is refused.
  - `UNIT`: `unitId` (UUID) is required. `productId` and `quantity` are refused: a unit is one physical item and always one label.
- The same product or the same unit may appear only once. To print a product more times, raise its `quantity`. Different units of the same product are separate items.

**Response (200):** `ResolvedLabelQueueResponseDto`

```json
{
  "data": [
    {
      "kind": "PRODUCT", "product_id": "uuid", "name": "USB-C Charger 20W", "model": null,
      "sku": "SKU-000123", "barcode": "SLP-000123", "barcode_type": "CODE_128",
      "selling_price": "4500.00", "quantity": 2
    },
    {
      "kind": "UNIT", "unit_id": "uuid", "unit_code": "SLU00000123", "product_id": "uuid",
      "name": "iPhone 13 128GB", "tracking_method": "IMEI", "identifier_type": "IMEI",
      "identifier": "356938035643809", "selling_price": "185000.00",
      "branch": { "id": "uuid", "name": "Main Shop" }
    },
    {
      "kind": "UNIT", "unit_id": "uuid", "unit_code": "SLU00000124", "product_id": "uuid",
      "name": "Work Laptop", "tracking_method": "SERIAL_NUMBER", "identifier_type": "SERIAL_NUMBER",
      "identifier": "LAP-SN-0001", "selling_price": null,
      "branch": { "id": "uuid", "name": "Main Shop" }
    }
  ],
  "total_labels": 4
}
```

- `data` has one row per item, in the order sent. A `PRODUCT` row is the product label row plus `quantity`, sent once rather than repeated. A `UNIT` row is the unit label row, one label.
- `total_labels` is the sum of the product quantities plus one per unit, at most 500.

**All or nothing.** If any item can't be printed, the answer is a single 400 that lists every such item, and it holds no rows. Errors:

| Status | Body | When |
|---|---|---|
| 400 | ValidationPipe `message` array | Missing, empty or over 500 `items`; an item that isn't an object; an unknown `type`; a missing or malformed id; a bad `quantity` (0, over 500, a fraction, a string); a field on the wrong kind of item; an unknown field; a malformed `branchId` |
| 400 | `{ message, code: 'LABEL_LIMIT_EXCEEDED', total_labels, max_labels: 500 }` | Over 500 labels in all. Checked before the database is read |
| 400 | `{ message, code: 'INVALID_LABEL_ITEMS', errors: [{ index, reason, message }] }` | One or more items can't be printed; `index` is the item's position in `items` |
| 401 | | No session |
| 403 | `{ message, code: 'WRONG_BRANCH' }`, or the role message | A manager naming another branch, or a cashier |

`reason` values:

| Reason | Meaning |
|---|---|
| `DUPLICATE_PRODUCT` | The product is already earlier in the queue |
| `DUPLICATE_UNIT` | The unit is already earlier in the queue |
| `PRODUCT_NOT_FOUND` | No such product (or it is soft-deleted) |
| `PRODUCT_INACTIVE` | The product is deactivated |
| `PRODUCT_NOT_QUANTITY_TRACKED` | An IMEI or serial product: print unit labels instead |
| `UNIT_NOT_FOUND` | No such unit, or it is at another branch than the scope |
| `UNIT_NOT_IN_STOCK` | The unit is `SOLD`, `RETURNED`, `WRITTEN_OFF` or `INSPECTION` |
| `UNIT_PRODUCT_INACTIVE` | The unit's product is deactivated |
| `UNIT_NOT_SERIALIZED` | The unit's product is quantity-tracked: print a product label instead |

A repeated item is reported once, as the duplicate. Its first occurrence is the one checked for the other reasons.

**Queries.** Whatever the queue's length, there are at most two queries, with nothing read per item: the products by id, then the units by id with their product and branch. Neither selects a buying price. No transaction is opened, because nothing is written. A unit sold after the answer is still refused at the till by the till's own checks.

## Swagger

Under the **Barcode Labels** tag. The two search responses are `{ data, meta }` with `PaginationMeta`. The queue's `data` is documented as `oneOf` `ResolvedProductQueueItemDto` and `ResolvedUnitQueueItemDto`, discriminated by `kind`. Both extend the row DTOs, and the generated schemas carry the inherited fields. `barcode-labels.swagger.spec.ts` builds the document from the controller alone (no database) and checks the routes, parameters, schemas, inheritance and discriminator.

**Request items are one flat schema.** `LabelQueueItemDto` has `type` plus optional `productId`, `quantity` and `unitId`, rather than one class per type. A class-transformer discriminator would throw a 500 on a `null` or non-object element before validation runs. With the flat class, that is a 400, and the per-type rules in the table above are enforced by validators.

## Tests

| Spec | Database | What it covers |
|---|---|---|
| `src/barcode-labels/barcode-labels.service.spec.ts` | None (recording query builder) | Columns selected, filters, LIKE escaping, Brackets, paging, IMEI/serial/legacy mapping, price fallback, no cost or relation in rows; queue order, `total_labels`, the 500 limit, duplicates, branch, status, active and tracking checks, all-or-nothing, at most two queries |
| `src/barcode-labels/barcode-labels.controller.spec.ts` | None | Class-level roles and no override, the real `RolesGuard` per route (admin and manager in, cashier out), no `@Public`, `scopeBranch` for admins and managers |
| `src/barcode-labels/dto/resolve-label-queue.dto.spec.ts` | None | The request DTOs through the `main.ts` ValidationPipe |
| `src/barcode-labels/barcode-labels.swagger.spec.ts` | None | The generated Swagger document |
| `test/barcode-labels.e2e-spec.ts` | Test DB (truncates it) | The three endpoints over HTTP: 401/403, branch scoping, filters, literal `%` and `_`, the database-generated `unit_code`, no cost in any body, the queue's errors. **Not executed yet** |

## Not in this stage

- **The Barcode Labels page**, which is Stage 3: moving it to these endpoints, encoding `unit_code`, and removing its cost-price option.
- **Product barcodes shaped like a unit code** (see `FOLLOWUPS.md`). A product's `barcode` accepts any text, and the till tries a unit-code lookup first, so a product barcode such as `SLU00000042` would not scan as that product.
