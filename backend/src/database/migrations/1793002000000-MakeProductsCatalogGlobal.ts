import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product records describe catalog models. Branch stock and purchase cost
 * belong to received inventory, so new catalog products may have neither
 * until a receiving workflow supplies them. Existing values are preserved.
 */
export class MakeProductsCatalogGlobal1793002000000
  implements MigrationInterface
{
  name = 'MakeProductsCatalogGlobal1793002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "branch_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "buying_price" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "branch_id" = (
         SELECT "id" FROM "branches" WHERE "is_active" = true
         ORDER BY "created_at", "id" LIMIT 1
       ) WHERE "branch_id" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "products" SET "buying_price" = 0 WHERE "buying_price" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "buying_price" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "branch_id" SET NOT NULL`,
    );
  }
}
