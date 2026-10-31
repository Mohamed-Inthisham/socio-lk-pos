import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The stock movement ledger (Phase 1 T1a): one append-only row per change
 * to a stock row's quantity or a product unit's status, written by
 * StockService in the same transaction as the change.
 *
 * Creates the table empty. The opening balances (one OPENING_BALANCE per
 * existing stock row) are backfilled by T1b's migration, in the same
 * release that makes every stock change write its row, so no deployed
 * version has a ledger that misses movements.
 *
 * Append-only: a trigger refuses UPDATE and DELETE, and TRUNCATE unless
 * the session sets socio.allow_ledger_truncate = 'on' (the e2e reset does,
 * with SET LOCAL). It guards against mistakes, not against the table's
 * owner, who can still drop or disable the triggers.
 *
 * Foreign keys are RESTRICT, so history can't disappear with a product,
 * branch, unit or user (products are deactivated and users soft-deleted).
 * Two partial unique indexes allow one row per business event: per stock
 * row for quantity movements, per unit for unit movements.
 */
export class CreateStockMovements1793500000000 implements MigrationInterface {
  name = 'CreateStockMovements1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stock_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "seq" bigint GENERATED ALWAYS AS IDENTITY,
        "product_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "product_unit_id" uuid,
        "movement_type" varchar(30) NOT NULL,
        "quantity_delta" integer NOT NULL,
        "quantity_before" integer NOT NULL,
        "quantity_after" integer NOT NULL,
        "stock_managed" boolean NOT NULL,
        "unit_status_from" varchar(20),
        "unit_status_to" varchar(20),
        "reason_code" varchar(40),
        "note" text,
        "reference_type" varchar(40) NOT NULL,
        "reference_id" uuid NOT NULL,
        "reverses_movement_id" uuid,
        "created_by_id" uuid,
        "approved_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_movements_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_movements_seq" UNIQUE ("seq"),
        CONSTRAINT "CHK_stock_movements_type" CHECK ("movement_type" IN ('OPENING_BALANCE', 'PURCHASE', 'TRADE_IN', 'SALE', 'REVERSAL', 'CUSTOMER_RETURN', 'INSPECTION_PASSED', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')),
        CONSTRAINT "CHK_stock_movements_reference_type" CHECK ("reference_type" IN ('STOCK', 'STOCK_ADJUSTMENT', 'STOCK_PURCHASE_ITEM', 'PHONE_PURCHASE', 'PAYMENT', 'SALE_LINE', 'SALE_RETURN_LINE')),
        CONSTRAINT "CHK_stock_movements_chain" CHECK ("quantity_after" = "quantity_before" + "quantity_delta" AND "quantity_before" >= 0 AND "quantity_after" >= 0),
        CONSTRAINT "CHK_stock_movements_unit_status" CHECK (("unit_status_from" IS NULL OR "unit_status_from" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION')) AND ("unit_status_to" IS NULL OR "unit_status_to" IN ('IN_STOCK', 'SOLD', 'RETURNED', 'WRITTEN_OFF', 'INSPECTION'))),
        CONSTRAINT "CHK_stock_movements_unit" CHECK (CASE WHEN "product_unit_id" IS NULL THEN "unit_status_from" IS NULL AND "unit_status_to" IS NULL ELSE "unit_status_to" IS NOT NULL END),
        CONSTRAINT "CHK_stock_movements_nonzero" CHECK ("quantity_delta" <> 0 OR "unit_status_from" IS DISTINCT FROM "unit_status_to" OR "movement_type" = 'OPENING_BALANCE'),
        CONSTRAINT "CHK_stock_movements_adjustment" CHECK (("movement_type" NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') OR length(trim(coalesce("reason_code", ''))) > 0) AND ("movement_type" <> 'ADJUSTMENT_IN' OR "quantity_delta" > 0) AND ("movement_type" <> 'ADJUSTMENT_OUT' OR "quantity_delta" < 0)),
        CONSTRAINT "CHK_stock_movements_reverses" CHECK ("reverses_movement_id" IS NULL OR "movement_type" = 'REVERSAL'),
        CONSTRAINT "CHK_stock_movements_created_by" CHECK ("created_by_id" IS NOT NULL OR "movement_type" = 'OPENING_BALANCE'),
        CONSTRAINT "CHK_stock_movements_approved_by" CHECK (("movement_type" IN ('REVERSAL', 'CUSTOMER_RETURN')) = ("approved_by_id" IS NOT NULL)),
        CONSTRAINT "FK_stock_movements_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_stock_movements_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_stock_movements_product_unit" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_stock_movements_reverses" FOREIGN KEY ("reverses_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_stock_movements_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_stock_movements_approved_by" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    // History by stock row, by unit, by business row, and by branch and day.
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_product_branch_seq" ON "stock_movements" ("product_id", "branch_id", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_unit_seq" ON "stock_movements" ("product_unit_id", "seq") WHERE "product_unit_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_reference" ON "stock_movements" ("reference_type", "reference_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_branch_created_at" ON "stock_movements" ("branch_id", "created_at")`,
    );

    // One row per business event: quantity movements per stock row, unit
    // movements per unit. Partial, so no key column is ever NULL.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_stock_movements_event_quantity" ON "stock_movements" ("movement_type", "reference_type", "reference_id") WHERE "product_unit_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_stock_movements_event_unit" ON "stock_movements" ("movement_type", "reference_type", "reference_id", "product_unit_id") WHERE "product_unit_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "stock_movements_append_only"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'TRUNCATE'
           AND current_setting('socio.allow_ledger_truncate', true) = 'on' THEN
          RETURN NULL;
        END IF;
        RAISE EXCEPTION 'stock_movements is append-only: % is not allowed', TG_OP;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_stock_movements_no_update_delete"
      BEFORE UPDATE OR DELETE ON "stock_movements"
      FOR EACH ROW EXECUTE FUNCTION "stock_movements_append_only"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_stock_movements_no_truncate"
      BEFORE TRUNCATE ON "stock_movements"
      FOR EACH STATEMENT EXECUTE FUNCTION "stock_movements_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_stock_movements_no_truncate" ON "stock_movements"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "trg_stock_movements_no_update_delete" ON "stock_movements"`,
    );
    await queryRunner.query(`DROP FUNCTION "stock_movements_append_only"()`);
    await queryRunner.query(`DROP TABLE "stock_movements"`);
  }
}
