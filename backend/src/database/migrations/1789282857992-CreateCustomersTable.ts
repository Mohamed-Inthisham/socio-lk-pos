import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.3.5 Slice A: Customer entity.
 *
 * Customers are individuals we buy phones from and/or sell phones to.
 * Introduced now because Phase 6.3.5 (used phones) needs a customer FK
 * on PhonePurchase, and Phase 6.3 already added Sale.customer_id as a
 * bare nullable UUID pending this entity landing.
 *
 * Design notes:
 * - NIC is nullable (walk-ins may not have it handy) but unique when set
 *   via a PARTIAL unique index (Postgres-specific: makes intent explicit
 *   and skips indexing NULL rows).
 * - phone is indexed but NOT unique — family members share numbers,
 *   shops share landlines, etc.
 * - name is indexed to support prefix search in the list endpoint.
 * - No address column: we identify customers by NIC + phone. Delivery
 *   address belongs on a future Order/Delivery entity, not here.
 * - Soft delete via deleted_at (matches Product/Brand/Category pattern).
 */
export class CreateCustomersTable1789282857992 implements MigrationInterface {
  name = 'CreateCustomersTable1789282857992';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(200) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "nic" varchar(20),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_customers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_customers_phone" ON "customers" ("phone")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_customers_name" ON "customers" ("name")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_customers_nic_unique"
        ON "customers" ("nic")
        WHERE "nic" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_customers_nic_unique"`);
    await queryRunner.query(`DROP INDEX "idx_customers_name"`);
    await queryRunner.query(`DROP INDEX "idx_customers_phone"`);
    await queryRunner.query(`DROP TABLE "customers"`);
  }
}
