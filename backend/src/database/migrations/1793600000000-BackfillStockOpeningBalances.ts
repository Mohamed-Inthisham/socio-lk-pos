import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The stock ledger's opening balances (Phase 1 T1b): one OPENING_BALANCE
 * movement per existing stock row, its quantity at this moment (zero and
 * untracked rows included), so every row's ledger chain starts from what
 * the shop holds when the fully wired backend goes live. No unit rows and
 * no historical movements are invented; stock is only read.
 *
 * Deploy: stop every backend instance, run this migration, start the new
 * backend at once, then run the reconciliation (docs/backend/
 * stock-ledger.md). An old instance left running would change stock
 * without ledger rows.
 *
 * - stock_ledger_backfill: the completion marker, one row, written in the
 *   same transaction as the openings; immutable (UPDATE / DELETE refused,
 *   TRUNCATE only with socio.allow_ledger_truncate, as for the ledger).
 * - backfill_stock_opening_balances(lock_wait): kept in the database so an
 *   operator can re-run it safely; it returns 0 once the marker exists.
 *   Execution is revoked from PUBLIC; only an authorized database
 *   operator should run it, with every backend stopped.
 *
 * Locks: EXCLUSIVE on stock, then SHARE ROW EXCLUSIVE on stock_movements.
 * Stock first, as every ledger writer does (it locks or writes the stock
 * row before inserting its movement): the backfill waits for running
 * stock transactions to finish and holds off new ones, without a
 * lock-order deadlock; plain reads of stock continue. lock_wait bounds
 * the wait (default 30 s).
 */
export class BackfillStockOpeningBalances1793600000000 implements MigrationInterface {
  name = 'BackfillStockOpeningBalances1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stock_ledger_backfill" (
        "id" smallint NOT NULL DEFAULT 1,
        "completed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "stock_rows" integer NOT NULL,
        "opening_rows" integer NOT NULL,
        CONSTRAINT "PK_stock_ledger_backfill_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_ledger_backfill_single" CHECK ("id" = 1)
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION "stock_ledger_backfill_immutable"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'TRUNCATE'
           AND current_setting('socio.allow_ledger_truncate', true) = 'on' THEN
          RETURN NULL;
        END IF;
        RAISE EXCEPTION 'stock_ledger_backfill is immutable: % is not allowed', TG_OP;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_stock_ledger_backfill_no_update_delete"
      BEFORE UPDATE OR DELETE ON "stock_ledger_backfill"
      FOR EACH ROW EXECUTE FUNCTION "stock_ledger_backfill_immutable"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_stock_ledger_backfill_no_truncate"
      BEFORE TRUNCATE ON "stock_ledger_backfill"
      FOR EACH STATEMENT EXECUTE FUNCTION "stock_ledger_backfill_immutable"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "backfill_stock_opening_balances"(
        "lock_wait" interval DEFAULT interval '30 seconds'
      ) RETURNS integer
      LANGUAGE plpgsql AS $$
      DECLARE
        wait_ms   bigint;
        inserted  integer;
        bad       text;
        n_stock   integer;
        n_opening integer;
      BEGIN
        -- A positive wait of at least 1 ms: 0 would disable lock_timeout.
        wait_ms := floor(extract(epoch FROM "lock_wait") * 1000);
        IF "lock_wait" IS NULL OR wait_ms IS NULL OR wait_ms < 1 THEN
          RAISE EXCEPTION 'lock_wait must be a positive interval of at least 1 millisecond (got %)', "lock_wait";
        END IF;
        PERFORM set_config('lock_timeout', wait_ms || 'ms', true);

        -- Stock first, then the ledger, as every writer does.
        LOCK TABLE "stock" IN EXCLUSIVE MODE;
        LOCK TABLE "stock_movements" IN SHARE ROW EXCLUSIVE MODE;

        -- Completed earlier: nothing to do or check (stock rows created
        -- since go-live rightly have no opening balance).
        IF EXISTS (SELECT 1 FROM "stock_ledger_backfill") THEN
          RETURN 0;
        END IF;

        -- Every existing opening must be the valid opening of a stock row.
        SELECT string_agg(o."id"::text, ', ' ORDER BY o."seq") INTO bad
          FROM "stock_movements" o
         WHERE o."movement_type" = 'OPENING_BALANCE'
           AND NOT EXISTS (
                 SELECT 1 FROM "stock" s
                  WHERE o."reference_type" = 'STOCK'
                    AND o."reference_id" = s."id"
                    AND o."product_id" = s."product_id"
                    AND o."branch_id" = s."branch_id"
                    AND o."product_unit_id" IS NULL
                    AND o."quantity_before" = 0);
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'Opening-balance backfill refused: opening movements % do not belong to a stock row', bad;
        END IF;

        -- A valid opening must come before every other movement of its row.
        SELECT string_agg(s."id"::text, ', ' ORDER BY s."id") INTO bad
          FROM "stock" s
          JOIN "stock_movements" o
            ON o."movement_type" = 'OPENING_BALANCE'
           AND o."reference_type" = 'STOCK'
           AND o."reference_id" = s."id"
         WHERE EXISTS (SELECT 1 FROM "stock_movements" m
                        WHERE m."product_id" = s."product_id"
                          AND m."branch_id" = s."branch_id"
                          AND m."seq" < o."seq");
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'Opening-balance backfill refused: stock rows % have an opening balance after other movements', bad;
        END IF;

        -- A row with real movements but no opening can't get one: it would
        -- sit after them in the chain.
        SELECT string_agg(s."id"::text, ', ' ORDER BY s."id") INTO bad
          FROM "stock" s
         WHERE EXISTS (SELECT 1 FROM "stock_movements" m
                        WHERE m."product_id" = s."product_id"
                          AND m."branch_id" = s."branch_id"
                          AND m."movement_type" <> 'OPENING_BALANCE')
           AND NOT EXISTS (SELECT 1 FROM "stock_movements" o
                            WHERE o."movement_type" = 'OPENING_BALANCE'
                              AND o."reference_type" = 'STOCK'
                              AND o."reference_id" = s."id");
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'Opening-balance backfill refused: stock rows % already have movements without an opening balance', bad;
        END IF;

        -- One opening per stock row with no ledger history at all.
        INSERT INTO "stock_movements"
          ("product_id", "branch_id", "movement_type", "quantity_delta",
           "quantity_before", "quantity_after", "stock_managed",
           "reference_type", "reference_id", "created_by_id", "approved_by_id")
        SELECT s."product_id", s."branch_id", 'OPENING_BALANCE', s."quantity", 0,
               s."quantity", s."manage_stock", 'STOCK', s."id", NULL, NULL
          FROM "stock" s
         WHERE NOT EXISTS (SELECT 1 FROM "stock_movements" m
                            WHERE m."product_id" = s."product_id"
                              AND m."branch_id" = s."branch_id")
         ORDER BY s."product_id", s."branch_id";
        GET DIAGNOSTICS inserted = ROW_COUNT;

        -- Exactly one valid opening per stock row, and as many openings as
        -- stock rows, before the marker is written.
        SELECT string_agg(s."id"::text, ', ' ORDER BY s."id") INTO bad
          FROM "stock" s
         WHERE (SELECT count(*) FROM "stock_movements" o
                 WHERE o."movement_type" = 'OPENING_BALANCE'
                   AND o."reference_type" = 'STOCK'
                   AND o."reference_id" = s."id"
                   AND o."product_id" = s."product_id"
                   AND o."branch_id" = s."branch_id"
                   AND o."product_unit_id" IS NULL
                   AND o."quantity_before" = 0) <> 1;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'Opening-balance backfill failed: stock rows % do not have exactly one valid opening balance', bad;
        END IF;
        SELECT count(*) INTO n_stock FROM "stock";
        SELECT count(*) INTO n_opening FROM "stock_movements"
         WHERE "movement_type" = 'OPENING_BALANCE';
        IF n_opening <> n_stock THEN
          RAISE EXCEPTION 'Opening-balance backfill failed: % opening balances for % stock rows', n_opening, n_stock;
        END IF;

        INSERT INTO "stock_ledger_backfill" ("stock_rows", "opening_rows")
        VALUES (n_stock, n_opening);
        RETURN inserted;
      END;
      $$
    `);
    await queryRunner.query(`
      COMMENT ON FUNCTION "backfill_stock_opening_balances"(interval) IS
        'Phase 1 T1b. Writes one OPENING_BALANCE per stock row with no ledger history, once: stock_ledger_backfill marks completion. Safe to re-run (returns 0 once completed). Only an authorized database operator should execute it, with every backend instance stopped.'
    `);
    await queryRunner.query(
      `REVOKE ALL ON FUNCTION "backfill_stock_opening_balances"(interval) FROM PUBLIC`,
    );

    await queryRunner.query(`SELECT "backfill_stock_opening_balances"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Locks first, in the backfill's order, so no movement can be written
    // between the check and the removal.
    await queryRunner.query(`SET LOCAL lock_timeout = '30s'`);
    await queryRunner.query(`LOCK TABLE "stock" IN EXCLUSIVE MODE`);
    await queryRunner.query(
      `LOCK TABLE "stock_movements" IN SHARE ROW EXCLUSIVE MODE`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "stock_movements"
                    WHERE "movement_type" <> 'OPENING_BALANCE') THEN
          RAISE EXCEPTION 'Rollback refused: stock_movements has movements other than opening balances';
        END IF;
      END;
      $$
    `);
    // The append-only trigger is off only in this transaction, under the
    // locks above; any failure rolls it back on.
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DISABLE TRIGGER "trg_stock_movements_no_update_delete"`,
    );
    await queryRunner.query(
      `DELETE FROM "stock_movements" WHERE "movement_type" = 'OPENING_BALANCE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ENABLE TRIGGER "trg_stock_movements_no_update_delete"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "backfill_stock_opening_balances"(interval)`,
    );
    await queryRunner.query(`DROP TABLE "stock_ledger_backfill"`);
    await queryRunner.query(
      `DROP FUNCTION "stock_ledger_backfill_immutable"()`,
    );
  }
}
