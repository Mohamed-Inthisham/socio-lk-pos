import {
  paginate,
  PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import { StockStatus } from './enums/stock-status.enum';

/**
 * GET /stock/overview (INV-F4): one row per product, with its stock across
 * the scope (one branch, or every branch, inactive ones included).
 *
 * Every field is named here and in the SQL below, so no buying or cost price
 * can reach a response: this is plain data, which @ExposeCost doesn't cover,
 * and the overview shows the selling price only, to every role.
 */
export interface StockOverviewBranch {
  id: string;
  name: string;
  is_active: boolean;
  /** Null on an untracked row: its stored quantity doesn't move. */
  quantity: number | null;
  min_quantity: number;
  manage_stock: boolean;
  stock_status: StockStatus;
}

export interface StockOverviewRow {
  id: string;
  name: string;
  sku: string;
  tracking_method: TrackingMethod;
  is_active: boolean;
  selling_price: string | null;
  brand: { id: string; name: string };
  category: { id: string; name: string };
  stock_status: StockStatus;
  /** Tracked rows only; null when NOT_TRACKED. */
  quantity: number | null;
  min_quantity: number;
  /** Null for a QUANTITY product, which has no units. */
  units: { in_stock: number; inspection: number } | null;
  branches: StockOverviewBranch[];
}

export interface StockOverviewSummary {
  total_products: number;
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
  not_tracked: number;
  total_quantity: number;
}

export type StockOverviewResponse = PaginatedResponse<StockOverviewRow> & {
  summary: StockOverviewSummary;
};

export interface StockOverviewProductRecord {
  id: string;
  name: string;
  sku: string;
  tracking_method: TrackingMethod;
  is_active: boolean;
  selling_price: string | null;
  brand_id: string;
  brand_name: string;
  category_id: string;
  category_name: string;
  quantity: number;
  min_quantity: number;
  in_stock_units: number;
  inspection_units: number;
  stock_status: StockStatus;
}

export interface StockOverviewBranchRecord {
  product_id: string;
  id: string;
  name: string;
  is_active: boolean;
  quantity: number;
  min_quantity: number;
  manage_stock: boolean;
  stock_status: StockStatus;
}

export type StockOverviewSummaryRecord = StockOverviewSummary & {
  matching: number;
};

const stockStatusSql = (
  untracked: string,
  quantity: string,
  minQuantity: string,
): string => `CASE
           WHEN ${untracked} THEN '${StockStatus.NOT_TRACKED}'
           WHEN ${quantity} = 0 THEN '${StockStatus.OUT_OF_STOCK}'
           WHEN ${quantity} <= ${minQuantity} THEN '${StockStatus.LOW_STOCK}'
           ELSE '${StockStatus.IN_STOCK}'
         END`;

/**
 * Stock and units are each reduced to one row per product before they meet
 * the products, so a product's rows never multiply each other. The branch
 * sits inside each aggregate, not in an outer WHERE, which would drop
 * products without a stock row.
 *
 * any_managed: true if a row in the scope is tracked, false if all of them
 * are untracked, null (no row at all) if the product has none: only false
 * is NOT_TRACKED, and a missing row is quantity 0.
 *
 * $1 branch or null, $2 includeInactive, $3 search pattern or null.
 */
const OVERVIEW_CTE = `WITH stock_scope AS (
  SELECT s.product_id,
         bool_or(s.manage_stock) AS any_managed,
         COALESCE(SUM(s.quantity) FILTER (WHERE s.manage_stock), 0)::int AS quantity,
         COALESCE(SUM(s.min_quantity) FILTER (WHERE s.manage_stock), 0)::int AS min_quantity
    FROM stock s
   WHERE $1::uuid IS NULL OR s.branch_id = $1::uuid
   GROUP BY s.product_id
), unit_scope AS (
  SELECT u.product_id,
         COUNT(*) FILTER (WHERE u.status = 'IN_STOCK')::int AS in_stock_units,
         COUNT(*) FILTER (WHERE u.status = 'INSPECTION')::int AS inspection_units
    FROM product_units u
   WHERE $1::uuid IS NULL OR u.branch_id = $1::uuid
   GROUP BY u.product_id
), overview AS (
  SELECT p.id, p.name, p.sku, p.tracking_method, p.is_active, p.selling_price,
         b.id AS brand_id, b.name AS brand_name,
         c.id AS category_id, c.name AS category_name,
         COALESCE(ss.quantity, 0) AS quantity,
         COALESCE(ss.min_quantity, 0) AS min_quantity,
         COALESCE(us.in_stock_units, 0) AS in_stock_units,
         COALESCE(us.inspection_units, 0) AS inspection_units,
         ${stockStatusSql('ss.any_managed IS FALSE', 'COALESCE(ss.quantity, 0)', 'COALESCE(ss.min_quantity, 0)')} AS stock_status
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_scope ss ON ss.product_id = p.id
    LEFT JOIN unit_scope us ON us.product_id = p.id
   WHERE p.deleted_at IS NULL
     AND ($2::boolean OR p.is_active)
     AND ($3::text IS NULL
          OR p.name ILIKE $3::text
          OR p.sku ILIKE $3::text
          OR p.barcode ILIKE $3::text)
)`;

/**
 * The cards, and the row count behind meta. $4 (status or null) narrows only
 * `matching`: the cards count every status.
 */
export const OVERVIEW_SUMMARY_SQL = `${OVERVIEW_CTE}
SELECT COUNT(*)::int AS total_products,
       COUNT(*) FILTER (WHERE stock_status = '${StockStatus.IN_STOCK}')::int AS in_stock,
       COUNT(*) FILTER (WHERE stock_status = '${StockStatus.LOW_STOCK}')::int AS low_stock,
       COUNT(*) FILTER (WHERE stock_status = '${StockStatus.OUT_OF_STOCK}')::int AS out_of_stock,
       COUNT(*) FILTER (WHERE stock_status = '${StockStatus.NOT_TRACKED}')::int AS not_tracked,
       COALESCE(SUM(quantity), 0)::int AS total_quantity,
       COUNT(*) FILTER (WHERE $4::text IS NULL OR stock_status = $4::text)::int AS matching
  FROM overview`;

/** One page. $4 status or null, $5 limit, $6 offset. */
export const OVERVIEW_PAGE_SQL = `${OVERVIEW_CTE}
SELECT id, name, sku, tracking_method, is_active, selling_price,
       brand_id, brand_name, category_id, category_name,
       quantity, min_quantity, in_stock_units, inspection_units, stock_status
  FROM overview
 WHERE $4::text IS NULL OR stock_status = $4::text
 ORDER BY name ASC, id ASC
 LIMIT $5::int OFFSET $6::int`;

/**
 * Each branch's own position, for the products on this page: a shortage at
 * one branch stays visible when the combined figure looks fine. $1 product
 * ids, $2 branch or null.
 */
export const OVERVIEW_BRANCHES_SQL = `SELECT s.product_id, br.id, br.name, br.is_active,
       s.quantity, s.min_quantity, s.manage_stock,
       ${stockStatusSql('NOT s.manage_stock', 's.quantity', 's.min_quantity')} AS stock_status
  FROM stock s
  JOIN branches br ON br.id = s.branch_id
 WHERE s.product_id = ANY($1::uuid[])
   AND ($2::uuid IS NULL OR s.branch_id = $2::uuid)
 ORDER BY br.name ASC, br.id ASC`;

const toBranch = (record: StockOverviewBranchRecord): StockOverviewBranch => ({
  id: record.id,
  name: record.name,
  is_active: record.is_active,
  quantity: record.manage_stock ? record.quantity : null,
  min_quantity: record.min_quantity,
  manage_stock: record.manage_stock,
  stock_status: record.stock_status,
});

const toRow = (
  record: StockOverviewProductRecord,
  branches: StockOverviewBranch[],
): StockOverviewRow => ({
  id: record.id,
  name: record.name,
  sku: record.sku,
  tracking_method: record.tracking_method,
  is_active: record.is_active,
  selling_price: record.selling_price,
  brand: { id: record.brand_id, name: record.brand_name },
  category: { id: record.category_id, name: record.category_name },
  stock_status: record.stock_status,
  quantity:
    record.stock_status === StockStatus.NOT_TRACKED ? null : record.quantity,
  min_quantity: record.min_quantity,
  units:
    record.tracking_method === TrackingMethod.QUANTITY
      ? null
      : {
          in_stock: record.in_stock_units,
          inspection: record.inspection_units,
        },
  branches,
});

/** Build the response from the three queries' records. */
export function toStockOverview(
  summary: StockOverviewSummaryRecord,
  products: StockOverviewProductRecord[],
  branches: StockOverviewBranchRecord[],
  page: number,
  limit: number,
): StockOverviewResponse {
  const byProduct = new Map<string, StockOverviewBranch[]>();
  for (const record of branches) {
    const list = byProduct.get(record.product_id) ?? [];
    list.push(toBranch(record));
    byProduct.set(record.product_id, list);
  }
  const rows = products.map((record) =>
    toRow(record, byProduct.get(record.id) ?? []),
  );
  return {
    ...paginate(rows, summary.matching, page, limit),
    summary: {
      total_products: summary.total_products,
      in_stock: summary.in_stock,
      low_stock: summary.low_stock,
      out_of_stock: summary.out_of_stock,
      not_tracked: summary.not_tracked,
      total_quantity: summary.total_quantity,
    },
  };
}
