import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductUnitsPhonePurchaseFk1789545906892 implements MigrationInterface {
  name = 'AddProductUnitsPhonePurchaseFk1789545906892';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_units"
      ADD CONSTRAINT "FK_product_units_phone_purchase"
      FOREIGN KEY ("phone_purchase_id")
      REFERENCES "phone_purchases"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_product_units_phone_purchase_id"
      ON "product_units" ("phone_purchase_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_product_units_phone_purchase_id"`);
    await queryRunner.query(
      `ALTER TABLE "product_units" DROP CONSTRAINT "FK_product_units_phone_purchase"`,
    );
  }
}
