import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStockTable1785310125998 implements MigrationInterface {
  name = 'CreateStockTable1785310125998';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stock" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT 0,
        "min_quantity" integer NOT NULL DEFAULT 0,
        "manage_stock" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_quantity_nonneg" CHECK ("quantity" >= 0),
        CONSTRAINT "CHK_stock_min_quantity_nonneg" CHECK ("min_quantity" >= 0)
      )`,
    );

    // Composite unique index — one stock row per product+branch pair.
    // Enforced at DB level so even raw SQL can't create duplicates.
    // In R1 with single branch: one row per product.
    // In R9 with multi-branch: N rows per product (one per branch).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_stock_product_branch"
       ON "stock" ("product_id", "branch_id")`,
    );

    // Individual index on product_id for "get stock across all branches
    // for this product" queries. Not covered by the composite index above
    // in that query pattern (composite index is optimized for lookups by
    // both columns).
    await queryRunner.query(
      `CREATE INDEX "idx_stock_product_id" ON "stock" ("product_id")`,
    );

    // Individual index on branch_id for "get all stock at this branch" queries.
    await queryRunner.query(
      `CREATE INDEX "idx_stock_branch_id" ON "stock" ("branch_id")`,
    );

    // FKs. CASCADE on product_id — if a product row is ever hard-deleted
    // (extremely rare — R1 uses is_active for lifecycle), its stock row
    // goes with it. RESTRICT on branch_id — cannot hard-delete a branch
    // that still has stock records pointing at it.
    await queryRunner.query(
      `ALTER TABLE "stock" ADD CONSTRAINT "FK_stock_product_id"
       FOREIGN KEY ("product_id") REFERENCES "products"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock" ADD CONSTRAINT "FK_stock_branch_id"
       FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
       ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock" DROP CONSTRAINT "FK_stock_branch_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock" DROP CONSTRAINT "FK_stock_product_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_stock_branch_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_stock_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_stock_product_branch"`);
    await queryRunner.query(`DROP TABLE "stock"`);
  }
}
