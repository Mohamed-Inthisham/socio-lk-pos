import { EntityManager } from 'typeorm';

/** One line of a discarded draft: what was rung up, never its cost price. */
export interface DraftSnapshotLine {
  line_number: number;
  product_id: string;
  product_sku_snapshot: string;
  product_name_snapshot: string;
  quantity: number;
  unit_price: string;
  discount_type: string | null;
  discount_value: string | null;
  discount_amount: string;
  line_total: string;
  product_unit_id: string | null;
  imei_snapshot: string | null;
  identifier_type_snapshot: string | null;
}

/** A draft sale as its DRAFT_DISCARDED audit row keeps it. */
export interface DraftSnapshot {
  id: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string | null;
  customer_id: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  lines: DraftSnapshotLine[];
}

/**
 * The drafts `ids` and their lines, read inside the caller's transaction
 * before it deletes them (the day close, DELETE /sales/:id). The caller
 * holds the sale rows locked, so nothing changes between this read and
 * the DELETE. No cost price is selected. Ordered by sale id.
 */
export async function readDraftSnapshots(
  manager: EntityManager,
  ids: string[],
): Promise<DraftSnapshot[]> {
  const sales: Omit<DraftSnapshot, 'lines'>[] = await manager.query(
    `SELECT s.id, s.branch_id, s.cashier_id, u.full_name AS cashier_name,
            s.customer_id, s.subtotal::text AS subtotal,
            s.discount_total::text AS discount_total,
            s.tax_total::text AS tax_total, s.total::text AS total,
            s.notes, s.created_at, s.updated_at
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ANY($1::uuid[])
      ORDER BY s.id`,
    [ids],
  );
  const lines: (DraftSnapshotLine & { sale_id: string })[] =
    await manager.query(
      `SELECT sl.sale_id, sl.line_number, sl.product_id,
              sl.product_sku_snapshot, sl.product_name_snapshot,
              sl.quantity, sl.unit_price::text AS unit_price,
              sl.discount_type, sl.discount_value::text AS discount_value,
              sl.discount_amount::text AS discount_amount,
              sl.line_total::text AS line_total, sl.product_unit_id,
              sl.imei_snapshot, sl.identifier_type_snapshot
         FROM sale_lines sl
        WHERE sl.sale_id = ANY($1::uuid[])
        ORDER BY sl.sale_id, sl.line_number`,
      [ids],
    );

  const linesBySale = new Map<string, DraftSnapshotLine[]>();
  for (const { sale_id: saleId, ...line } of lines) {
    linesBySale.set(saleId, [...(linesBySale.get(saleId) ?? []), line]);
  }
  return sales.map((sale) => ({
    ...sale,
    lines: linesBySale.get(sale.id) ?? [],
  }));
}
