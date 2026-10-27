import { MigrationInterface, QueryRunner } from 'typeorm';

export class DefineSerializedFlagAsImeiOnly1793100000000
  implements MigrationInterface
{
  name = 'DefineSerializedFlagAsImeiOnly1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products"
      DROP CONSTRAINT "CHK_products_tracking_serialized"`);
    await queryRunner.query(`UPDATE "products"
      SET "is_serialized" = ("tracking_method" = 'IMEI')`);
    await queryRunner.query(`ALTER TABLE "products"
      ADD CONSTRAINT "CHK_products_tracking_serialized"
      CHECK ("is_serialized" = ("tracking_method" = 'IMEI'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products"
      DROP CONSTRAINT "CHK_products_tracking_serialized"`);
    await queryRunner.query(`UPDATE "products"
      SET "is_serialized" = ("tracking_method" <> 'QUANTITY')`);
    await queryRunner.query(`ALTER TABLE "products"
      ADD CONSTRAINT "CHK_products_tracking_serialized"
      CHECK ("is_serialized" = ("tracking_method" <> 'QUANTITY'))`);
  }
}
