import { MigrationInterface, QueryRunner } from 'typeorm';

/** Schema foundation for purchase-linked, inventory-only supplier returns. */
export class CreateSupplierReturns1794100000000 implements MigrationInterface {
  name = 'CreateSupplierReturns1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "supplier_returns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "return_number" varchar(20) NOT NULL,
        "stock_purchase_id" uuid NOT NULL,
        "reason_code" varchar(20) NOT NULL,
        "note" varchar(500),
        "created_by_id" uuid NOT NULL,
        "client_request_id" uuid NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_returns_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supplier_returns_number" UNIQUE ("return_number"),
        CONSTRAINT "UQ_supplier_returns_client_request_id" UNIQUE ("client_request_id"),
        CONSTRAINT "CHK_supplier_returns_reason" CHECK ("reason_code" IN ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'EXCESS_STOCK', 'WARRANTY', 'OTHER')),
        CONSTRAINT "CHK_supplier_returns_other_note" CHECK ("reason_code" <> 'OTHER' OR length(trim(coalesce("note", ''))) > 0),
        CONSTRAINT "CHK_supplier_returns_request_hash" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "FK_supplier_returns_purchase" FOREIGN KEY ("stock_purchase_id") REFERENCES "stock_purchases"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_supplier_returns_creator" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_returns_purchase_created_at" ON "supplier_returns" ("stock_purchase_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "supplier_return_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "supplier_return_id" uuid NOT NULL,
        "stock_purchase_item_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "unit_cost_snapshot" numeric(12,2) NOT NULL,
        CONSTRAINT "PK_supplier_return_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supplier_return_lines_return_item" UNIQUE ("supplier_return_id", "stock_purchase_item_id"),
        CONSTRAINT "CHK_supplier_return_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_supplier_return_lines_unit_cost" CHECK ("unit_cost_snapshot" >= 0),
        CONSTRAINT "FK_supplier_return_lines_return" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_supplier_return_lines_purchase_item" FOREIGN KEY ("stock_purchase_item_id") REFERENCES "stock_purchase_items"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_return_lines_purchase_item" ON "supplier_return_lines" ("stock_purchase_item_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "supplier_return_line_units" (
        "supplier_return_line_id" uuid NOT NULL,
        "product_unit_id" uuid NOT NULL,
        CONSTRAINT "PK_supplier_return_line_units" PRIMARY KEY ("supplier_return_line_id", "product_unit_id"),
        CONSTRAINT "UQ_supplier_return_line_units_product_unit" UNIQUE ("product_unit_id"),
        CONSTRAINT "FK_supplier_return_line_units_line" FOREIGN KEY ("supplier_return_line_id") REFERENCES "supplier_return_lines"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_supplier_return_line_units_product_unit" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "product_units" DROP CONSTRAINT "CHK_product_units_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_units" ADD CONSTRAINT "CHK_product_units_status"
      CHECK ("status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION', 'SUPPLIER_RETURNED'))
    `);

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_type"
      CHECK ("movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WRITE_OFF', 'SUPPLIER_RETURN'))
    `);

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_reference_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_reference_type"
      CHECK ("reference_type" IN ('STOCK', 'STOCK_ADJUSTMENT', 'STOCK_PURCHASE_ITEM', 'PHONE_PURCHASE', 'PAYMENT', 'SALE_LINE', 'SALE_RETURN_LINE', 'SUPPLIER_RETURN'))
    `);

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_unit_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_unit_status"
      CHECK (("unit_status_from" IS NULL OR "unit_status_from" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION', 'SUPPLIER_RETURNED')) AND ("unit_status_to" IS NULL OR "unit_status_to" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION', 'SUPPLIER_RETURNED')))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Prevent concurrent return writes (including ledger-only writes) from racing the guard.
    await queryRunner.query(`
      LOCK TABLE "product_units", "stock_movements", "supplier_return_line_units",
        "supplier_return_lines", "supplier_returns" IN ACCESS EXCLUSIVE MODE
    `);
    const result: unknown = await queryRunner.query(`
      SELECT (
        (SELECT count(*) FROM "supplier_returns") +
        (SELECT count(*) FROM "stock_movements"
          WHERE "reference_type" = 'SUPPLIER_RETURN'
             OR "movement_type" = 'SUPPLIER_RETURN'
             OR "unit_status_from" = 'SUPPLIER_RETURNED'
             OR "unit_status_to" = 'SUPPLIER_RETURNED') +
        (SELECT count(*) FROM "product_units" WHERE "status" = 'SUPPLIER_RETURNED')
      )::text AS "dependent_count"
    `);
    const firstRow: unknown = Array.isArray(result) ? result[0] : undefined;
    const rawCount =
      firstRow !== null &&
      typeof firstRow === 'object' &&
      'dependent_count' in firstRow
        ? firstRow.dependent_count
        : '0';
    const dependentCount = typeof rawCount === 'string' ? BigInt(rawCount) : 0n;
    if (dependentCount > 0n) {
      throw new Error(
        'Cannot revert CreateSupplierReturns: supplier return records, ledger movements, or SUPPLIER_RETURNED units exist. Resolve through a forward migration; this migration does not delete historical data.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_unit_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_unit_status"
      CHECK (("unit_status_from" IS NULL OR "unit_status_from" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION')) AND ("unit_status_to" IS NULL OR "unit_status_to" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION')))
    `);

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_reference_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_reference_type"
      CHECK ("reference_type" IN ('STOCK', 'STOCK_ADJUSTMENT', 'STOCK_PURCHASE_ITEM', 'PHONE_PURCHASE', 'PAYMENT', 'SALE_LINE', 'SALE_RETURN_LINE'))
    `);

    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "CHK_stock_movements_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "stock_movements" ADD CONSTRAINT "CHK_stock_movements_type"
      CHECK ("movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WRITE_OFF'))
    `);

    await queryRunner.query(
      `ALTER TABLE "product_units" DROP CONSTRAINT "CHK_product_units_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_units" ADD CONSTRAINT "CHK_product_units_status"
      CHECK ("status" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION'))
    `);

    await queryRunner.query(`DROP TABLE "supplier_return_line_units"`);
    await queryRunner.query(
      `DROP INDEX "idx_supplier_return_lines_purchase_item"`,
    );
    await queryRunner.query(`DROP TABLE "supplier_return_lines"`);
    await queryRunner.query(
      `DROP INDEX "idx_supplier_returns_purchase_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "supplier_returns"`);
  }
}
