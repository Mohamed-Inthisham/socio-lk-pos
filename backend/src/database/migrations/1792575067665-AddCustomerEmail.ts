import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customers get an optional email (trimmed, lowercase, max 254 — RFC 5321).
 * Nullable, no default, and deliberately not unique: family members may
 * share one address. No index: the customer search matches it with
 * ILIKE '%…%', which an index wouldn't help.
 */
export class AddCustomerEmail1792575067665 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" ADD COLUMN "email" varchar(254) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "email"`);
  }
}
