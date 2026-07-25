import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read model for the tasks table. The API owns the schema and migrations
 * (see apps/api); this is a worker-local mapping used only to read tasks for
 * CSV export. Kept in sync with apps/api/src/tasks/task.entity.ts.
 */
@Entity('tasks')
export class Task {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar' })
  status!: string;

  @Column({ type: 'varchar' })
  priority!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
