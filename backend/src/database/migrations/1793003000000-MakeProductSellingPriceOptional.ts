import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeProductSellingPriceOptional1793003000000
  implements MigrationInterface
{
  name = 'MakeProductSellingPriceOptional1793003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "selling_price" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "selling_price" = 0 WHERE "selling_price" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "selling_price" SET NOT NULL`,
    );
  }
}
