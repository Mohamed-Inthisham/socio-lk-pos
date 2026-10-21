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

export const customer = (overrides = {}) => ({
  id: "cust-1",
  name: "Kamal Perera",
  phone: "0771234567",
  nic: "199012345678",
  deleted_at: null,
  ...overrides,
});

export const cashPayment = (overrides = {}) => ({
  id: "pay-cash",
  payment_method: "CASH",
  amount: "1500.00",
  cash_received: "2000.00",
  reference_number: null,
  ...overrides,
});

export const cardPayment = (overrides = {}) => ({
  id: "pay-card",
  payment_method: "CARD",
  amount: "1000.00",
  cash_received: null,
  reference_number: "AUTH-482913",
  ...overrides,
});

export const tradeInPayment = (overrides = {}) => ({
  id: "pay-ti",
  payment_method: "TRADE_IN",
  amount: "40000.00",
  trade_in_product_id: "p-phone",
  trade_in_imei: "354789102345678",
  trade_in_buying_price: "40000.00",
  ...overrides,
});

/**
 * A realistic COMPLETED sale for the receipt (P5 step E): a phone with
 * IMEI, 12-month warranty and a discount; an accessory on Checking; a
 * trade-in, a card and cash with change; a customer attached.
 * Lines: 64,990 − 1,000 + 2 × 1,500 = 66,990. Tenders: 40,000 trade-in +
 * 10,000 card + 16,990 cash (received 17,000 → change 10).
 */
export const completedSaleForReceipt = (overrides = {}) => ({
  id: "sale-done",
  sale_number: "INV-20261021-0007",
  status: "COMPLETED",
  completed_at: "2026-10-21T09:02:00.000Z",
  branch_id: "branch-main",
  branch: {
    id: "branch-main",
    name: "Main Shop",
    address: "86/10 Inner Circular Rd, Ratnapura",
    phone: "0778822391",
  },
  cashier: { id: "u-1", full_name: "Nimal Silva" },
  customer: { id: "cust-1", name: "Kamal Perera", phone: "0771234567", nic: "199012345678" },
  subtotal: "67990.00",
  discount_total: "1000.00",
  tax_total: "0.00",
  total: "66990.00",
  amount_paid: "66990.00",
  change_due: "10.00",
  lines: [
    saleLine({
      id: "line-phone",
      product_name_snapshot: "Samsung Galaxy A15 128GB",
      imei_snapshot: "356789012345671",
      unit_price: "64990.00",
      quantity: 1,
      discount_type: "AMOUNT",
      discount_value: "1000.00",
      discount_amount: "1000.00",
      line_total: "63990.00",
      warranty: "MONTH_12",
      warranty_until: "2027-10-21",
    }),
    saleLine({
      id: "line-cable",
      line_number: 2,
      quantity: 2,
      line_total: "3000.00",
      warranty: "CHECKING",
      warranty_until: null,
    }),
  ],
  payments: [
    tradeInPayment({
      trade_in_product: { id: "p-used", name: "Used iPhone 12 128GB" },
    }),
    cardPayment({ amount: "10000.00", reference_number: "AUTH-482913" }),
    cashPayment({ amount: "16990.00", cash_received: "17000.00" }),
  ],
  ...overrides,
});

/**
 * A COMPLETED sale with both till discount modes (P5-20) and both
 * no-warranty kinds (P5-19): 20% off 2 cases, 2 chargers at 1,600.00
 * each, a cable on No warranty, a screen glass on Checking. Walk-in, cash.
 * Lines: 3,200 + 3,200 + 1,500 + 1,000 = 8,900 (10,500 − 1,600).
 */
export const completedSaleWithDiscounts = (overrides = {}) => ({
  ...completedSaleForReceipt(),
  id: "sale-discounts",
  sale_number: "INV-20261021-0008",
  customer: null,
  subtotal: "10500.00",
  discount_total: "1600.00",
  total: "8900.00",
  amount_paid: "8900.00",
  change_due: "100.00",
  lines: [
    saleLine({
      id: "line-case",
      product_name_snapshot: "Silicone Case A15",
      unit_price: "2000.00",
      quantity: 2,
      discount_type: "PERCENT",
      discount_value: "20.00",
      discount_amount: "800.00",
      line_total: "3200.00",
      warranty: "CHECKING",
      warranty_until: null,
    }),
    saleLine({
      id: "line-charger",
      line_number: 2,
      product_name_snapshot: "25W Charger",
      unit_price: "2000.00",
      quantity: 2,
      discount_type: "UNIT_PRICE",
      discount_value: "1600.00",
      discount_amount: "800.00",
      line_total: "3200.00",
      warranty: "MONTH_6",
      warranty_until: "2027-04-21",
    }),
    saleLine({
      id: "line-cable",
      line_number: 3,
      quantity: 1,
      line_total: "1500.00",
      warranty: "NO_WARRANTY",
      warranty_until: null,
    }),
    saleLine({
      id: "line-glass",
      line_number: 4,
      product_name_snapshot: "Tempered Glass A15",
      unit_price: "1000.00",
      quantity: 1,
      line_total: "1000.00",
      warranty: "CHECKING",
      warranty_until: null,
    }),
  ],
  payments: [cashPayment({ amount: "8900.00", cash_received: "9000.00" })],
  ...overrides,
});
