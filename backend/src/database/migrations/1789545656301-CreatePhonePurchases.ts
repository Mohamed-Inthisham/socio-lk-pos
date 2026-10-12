import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePhonePurchases1789545656301 implements MigrationInterface {
  name = 'CreatePhonePurchases1789545656301';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "phone_purchases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "cashier_id" uuid NOT NULL,
        "total_amount" numeric(12,2) NOT NULL,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_phone_purchases_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_phone_purchases_total_amount_nonneg" CHECK ("total_amount" >= 0),
        CONSTRAINT "FK_phone_purchases_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_phone_purchases_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_phone_purchases_cashier" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_phone_purchases_customer_id" ON "phone_purchases" ("customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_phone_purchases_branch_id" ON "phone_purchases" ("branch_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_phone_purchases_cashier_id" ON "phone_purchases" ("cashier_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_phone_purchases_created_at" ON "phone_purchases" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_phone_purchases_created_at"`);
    await queryRunner.query(`DROP INDEX "idx_phone_purchases_cashier_id"`);
    await queryRunner.query(`DROP INDEX "idx_phone_purchases_branch_id"`);
    await queryRunner.query(`DROP INDEX "idx_phone_purchases_customer_id"`);
    await queryRunner.query(`DROP TABLE "phone_purchases"`);
  }
}
