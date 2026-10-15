/**
 * POS terminal fixtures — shapes mirror the backend responses
 * (money as numeric strings, hydrated sale with lines/payments).
 */

export const cableProduct = {
  id: "p-cable",
  name: "USB-C Cable 1m",
  sku: "ACC-0001",
  barcode: "4006381333931",
  selling_price: "1500.00",
  is_serialized: false,
  is_active: true,
  branch_id: "branch-main",
};

export const phoneProduct = {
  id: "p-phone",
  name: "iPhone 15 128GB",
  sku: "PHN-0001",
  barcode: "SLP-000042",
  selling_price: "245000.00",
  is_serialized: true,
  is_active: true,
  branch_id: "branch-main",
};

export const saleLine = (overrides = {}) => ({
  id: "line-1",
  line_number: 1,
  product_id: cableProduct.id,
  product_name_snapshot: cableProduct.name,
  product_sku_snapshot: cableProduct.sku,
  unit_price: "1500.00",
  quantity: 1,
  discount_type: null,
  discount_value: null,
  discount_amount: "0.00",
  line_total: "1500.00",
  imei_snapshot: null,
  ...overrides,
});

export const draftSale = (overrides = {}) => ({
  id: "sale-1",
  sale_number: null,
  status: "DRAFT",
  branch_id: "branch-main",
  customer: null,
  subtotal: "0.00",
  discount_total: "0.00",
  tax_total: "0.00",
  total: "0.00",
  amount_paid: "0.00",
  created_at: "2026-10-15T04:30:00.000Z",
  lines: [],
  payments: [],
  ...overrides,
});
