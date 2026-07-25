import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExports1720000003000 implements MigrationInterface {
  name = 'CreateExports1720000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" varchar(30) NOT NULL,
        "s3_bucket" varchar(255),
        "s3_key" text,
        "error_code" varchar(100),
        "error_message" text,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_exports_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_exports_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_exports_status"
          CHECK ("status" IN ('queued', 'processing', 'completed', 'failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "exports_user_requested_idx" ON "exports" ("user_id", "requested_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "exports_user_requested_idx"`);
    await queryRunner.query(`DROP TABLE "exports"`);
  }
}
