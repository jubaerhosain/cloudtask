import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTasks1720000002000 implements MigrationInterface {
  name = 'CreateTasks1720000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" text,
        "status" varchar(30) NOT NULL,
        "priority" varchar(20) NOT NULL,
        "due_date" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tasks_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tasks_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_tasks_status" CHECK ("status" IN ('todo', 'in_progress', 'done')),
        CONSTRAINT "CHK_tasks_priority" CHECK ("priority" IN ('low', 'medium', 'high'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "tasks_project_created_idx" ON "tasks" ("project_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "tasks_owner_status_idx" ON "tasks" ("owner_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "tasks_owner_priority_idx" ON "tasks" ("owner_id", "priority")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "tasks_owner_priority_idx"`);
    await queryRunner.query(`DROP INDEX "tasks_owner_status_idx"`);
    await queryRunner.query(`DROP INDEX "tasks_project_created_idx"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
  }
}
