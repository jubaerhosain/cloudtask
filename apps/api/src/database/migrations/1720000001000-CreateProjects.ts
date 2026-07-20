import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1720000001000 implements MigrationInterface {
  name = 'CreateProjects1720000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_projects_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "projects_owner_created_idx" ON "projects" ("owner_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "projects_owner_created_idx"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
