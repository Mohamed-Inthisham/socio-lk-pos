import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkuBarcodeCountersTable1785304858044 implements MigrationInterface {
  name = 'CreateSkuBarcodeCountersTable1785304858044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sku_barcode_counters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "counter_type" character varying(20) NOT NULL,
        "prefix" character varying(20) NOT NULL,
        "current_value" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_sku_barcode_counters_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sku_barcode_counters_type" UNIQUE ("counter_type"),
        CONSTRAINT "CHK_sku_barcode_counters_type"
          CHECK ("counter_type" IN ('SKU', 'BARCODE'))
      )`,
    );

    // Seed the two counters. These are schema invariants — the system
    // cannot generate SKUs or barcodes without them existing. Both start
    // at 0 so the first generated value is 1 → 'SKU-000001' or 'SLP-000001'.
    await queryRunner.query(
      `INSERT INTO "sku_barcode_counters" ("counter_type", "prefix", "current_value")
       VALUES
         ('SKU', 'SKU-', 0),
         ('BARCODE', 'SLP-', 0)
       ON CONFLICT ("counter_type") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sku_barcode_counters"`);
  }
}
