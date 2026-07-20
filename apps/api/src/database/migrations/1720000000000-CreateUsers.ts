import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1720000000000 implements MigrationInterface {
  name = 'CreateUsers1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built into Postgres 13+; the extension is a harmless
    // safety net for older engines.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(320) NOT NULL,
        "password_hash" text NOT NULL,
        "display_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);
    // Case-insensitive uniqueness on email (spec §7).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" (lower("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "users_email_lower_uq"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
