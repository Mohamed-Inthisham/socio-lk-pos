/**
 * GET /sales/:id fixtures, copied from the backend entities (P6 step C).
 *
 * The response is SalesService.findOne serialized by the global
 * ClassSerializerInterceptor: entity columns as they are (no renames;
 * numeric → string, timestamptz → ISO string, date → "YYYY-MM-DD"), minus
 * @Exclude fields, plus the relations findOne loads: branch, cashier,
 * customer, voider, void_requester, lines, payments,
 * payments.trade_in_product (backend/src/sales/sales.service.ts findOne).
 * A loaded relation that is empty is null; relations not loaded are
 * absent (lines: product, external_supplier, product_unit; payments:
 * trade_in_phone_purchase).
 *
 * Each builder names its entity file. Keep them in step with the entity,
 * not with what the screen happens to read.
 */

const T0 = "2026-09-01T04:00:00.000Z";

/** backend/src/branches/entities/branch.entity.ts */
export const branchEntity = (overrides = {}) => ({
  id: "branch-main",
  name: "Main Shop",
  address: "86/10 Inner Circular Rd, Ratnapura",
  phone: "0778822391",
  is_active: true,
  created_at: T0,
  updated_at: T0,
  ...overrides,
});

/** backend/src/users/entities/user.entity.ts, without the @Exclude columns */
export const userEntity = (overrides = {}) => ({
  id: "user-cashier",
  email: "nimal@socio.lk",
  full_name: "Nimal Silva",
  approval_pin_set_at: null,
  role: "cashier",
  is_active: true,
  branch_id: "branch-main",
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
  ...overrides,
});

/** backend/src/customers/entities/customer.entity.ts (`name`, not `full_name`) */
export const customerEntity = (overrides = {}) => ({
  id: "cust-1",
  name: "Kamal Perera",
  phone: "0771234567",
  nic: "199012345678",
  email: null,
  notes: null,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
  ...overrides,
});

/** backend/src/products/entities/product.entity.ts (as payments.trade_in_product; its own relations aren't loaded) */
export const productEntity = (overrides = {}) => ({
  id: "p-used-ip12",
  product_type: "PHONE",
  name: "Used iPhone 12 128GB",
  sku: "PHN-0042",
  barcode: "SLP-000042",
  barcode_type: "CODE_128",
  brand_id: "brand-apple",
  category_id: "cat-phones",
  branch_id: "branch-main",
  description: null,
  buying_price: "0.00",
  selling_price: "0.00",
  default_warranty: "MONTH_3",
  is_serialized: true,
  is_active: true,
  phone_condition: "USED",
  phone_model: "iPhone 12",
  phone_storage: "128GB",
  phone_color: null,
  phone_ram: null,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
  ...overrides,
});

/** backend/src/sales/entities/sale-line.entity.ts */
export const saleLineEntity = (overrides = {}) => ({
  id: "line-1",
  sale_id: "sale-7",
  line_number: 1,
  product_id: "p-cable",
  product_sku_snapshot: "ACC-0001",
  product_name_snapshot: "USB-C Cable 1m",
  unit_price: "1500.00",
  cost_price_snapshot: "600.00",
  quantity: 1,
  discount_type: null,
  discount_value: null,
  discount_amount: "0.00",
  line_total: "1500.00",
  external_supplier_id: null,
  imei_snapshot: null,
  warranty: "NO_WARRANTY",
  warranty_until: null,
  product_unit_id: null,
  created_at: "2026-10-21T08:50:00.000Z",
  updated_at: "2026-10-21T09:02:00.000Z",
  ...overrides,
});

/** backend/src/sales/entities/payment.entity.ts */
export const paymentEntity = (overrides = {}) => ({
  id: "pay-1",
  sale_id: "sale-7",
  payment_method: "CASH",
  amount: "1500.00",
  cash_received: null,
  reference_number: null,
  notes: null,
  reversed_at: null,
  reversal_reason: null,
  trade_in_product_id: null,
  trade_in_product: null,
  trade_in_imei: null,
  trade_in_buying_price: null,
  trade_in_selling_price: null,
  trade_in_notes: null,
  trade_in_phone_purchase_id: null,
  created_at: "2026-10-21T09:00:00.000Z",
  updated_at: "2026-10-21T09:00:00.000Z",
  ...overrides,
});

/**
 * backend/src/sales/entities/sale.entity.ts, hydrated as findOne returns it.
 *
 * A COMPLETED sale completed 21 Oct 2026, 14:32 Colombo, covering every
 * line and tender case:
 * - phone, IMEI, AMOUNT 1,000 off, 12 months (until 2027-10-21)
 * - 2 cases, PERCENT 20% (800 off), Checking
 * - charger, UNIT_PRICE 1,600 each (400 off), 6 months (until 2027-04-21)
 * - cable, no discount, No warranty
 * Subtotal 72,490 − 2,200 = 70,290. Tenders: trade-in 40,000 (resale
 * 52,000, notes) + card 10,000 + cash 20,290 (received 20,300, change 10).
 */
export const saleEntity = (overrides = {}) => ({
  id: "sale-7",
  sale_number: "INV-20261021-0007",
  sale_type: "RETAIL",
  status: "COMPLETED",
  branch_id: "branch-main",
  cashier_id: "user-cashier",
  customer_id: "cust-1",
  subtotal: "72490.00",
  discount_total: "2200.00",
  tax_total: "0.00",
  total: "70290.00",
  amount_paid: "70290.00",
  change_due: "10.00",
  notes: null,
  completed_at: "2026-10-21T09:02:00.000Z",
  voided_at: null,
  voided_by: null,
  void_requested_by: null,
  void_reason: null,
  created_at: "2026-10-21T08:45:00.000Z",
  updated_at: "2026-10-21T09:02:00.000Z",
  branch: branchEntity(),
  cashier: userEntity(),
  customer: customerEntity(),
  voider: null,
  void_requester: null,
  lines: [
    saleLineEntity({
      id: "line-phone",
      line_number: 1,
      product_id: "p-a15",
      product_sku_snapshot: "PHN-0007",
      product_name_snapshot: "Samsung Galaxy A15 128GB",
      unit_price: "64990.00",
      cost_price_snapshot: "52000.00",
      discount_type: "AMOUNT",
      discount_value: "1000.00",
      discount_amount: "1000.00",
      line_total: "63990.00",
      imei_snapshot: "356789012345671",
      warranty: "MONTH_12",
      warranty_until: "2027-10-21",
      product_unit_id: "unit-a15",
    }),
    saleLineEntity({
      id: "line-case",
      line_number: 2,
      product_id: "p-case",
      product_sku_snapshot: "ACC-0012",
      product_name_snapshot: "Silicone Case A15",
      unit_price: "2000.00",
      cost_price_snapshot: "700.00",
      quantity: 2,
      discount_type: "PERCENT",
      discount_value: "20.00",
      discount_amount: "800.00",
      line_total: "3200.00",
      warranty: "CHECKING",
    }),
    saleLineEntity({
      id: "line-charger",
      line_number: 3,
      product_id: "p-charger",
      product_sku_snapshot: "ACC-0020",
      product_name_snapshot: "25W Charger",
      unit_price: "2000.00",
      cost_price_snapshot: "1100.00",
      discount_type: "UNIT_PRICE",
      discount_value: "1600.00",
      discount_amount: "400.00",
      line_total: "1600.00",
      warranty: "MONTH_6",
      warranty_until: "2027-04-21",
    }),
    saleLineEntity({ id: "line-cable", line_number: 4 }),
  ],
  payments: [
    paymentEntity({
      id: "pay-ti",
      payment_method: "TRADE_IN",
      amount: "40000.00",
      trade_in_product_id: "p-used-ip12",
      trade_in_product: productEntity(),
      trade_in_imei: "354789102345678",
      trade_in_buying_price: "40000.00",
      trade_in_selling_price: "52000.00",
      trade_in_notes: "Screen scratch, battery 86%",
      trade_in_phone_purchase_id: "pp-1",
      created_at: "2026-10-21T08:58:00.000Z",
    }),
    paymentEntity({
      id: "pay-card",
      payment_method: "CARD",
      amount: "10000.00",
      reference_number: "AUTH-482913",
      created_at: "2026-10-21T08:59:00.000Z",
    }),
    paymentEntity({
      id: "pay-cash",
      payment_method: "CASH",
      amount: "20290.00",
      cash_received: "20300.00",
      created_at: "2026-10-21T09:00:00.000Z",
    }),
  ],
  ...overrides,
});

const VOID_REASON = "Wrong price — rang 64,990, was 59,990";

/** The same sale VOIDED 22 Oct 2026, 10:15 Colombo: approved by a manager on the cashier's session. */
export const voidedSaleEntity = (overrides = {}) => {
  const base = saleEntity();
  const voidedAt = "2026-10-22T04:45:00.000Z";
  return saleEntity({
    status: "VOIDED",
    voided_at: voidedAt,
    voided_by: "user-manager",
    void_requested_by: "user-cashier",
    void_reason: VOID_REASON,
    updated_at: voidedAt,
    voider: userEntity({ id: "user-manager", email: "asha@socio.lk", full_name: "Asha Perera", role: "manager", approval_pin_set_at: T0 }),
    void_requester: userEntity(),
    payments: base.payments.map((p) => ({ ...p, reversed_at: voidedAt, reversal_reason: VOID_REASON, updated_at: voidedAt })),
    ...overrides,
  });
};
