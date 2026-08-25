import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSaleNumberCountersTable1787637378573 implements MigrationInterface {
  name = 'CreateSaleNumberCountersTable1787637378573';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sale_number_counters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "branch_id" uuid NOT NULL,
        "counter_date" date NOT NULL,
        "last_number" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sale_number_counters_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sale_counter_branch_date" UNIQUE ("branch_id", "counter_date"),
        CONSTRAINT "CHK_sale_counter_last_number_nonneg" CHECK ("last_number" >= 0),
        CONSTRAINT "FK_sale_number_counters_branch_id"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_sale_number_counters_branch_id"
       ON "sale_number_counters" ("branch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_sale_number_counters_branch_id"`,
    );
    await queryRunner.query(`DROP TABLE "sale_number_counters"`);
  }
}
