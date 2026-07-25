import { TaskPriority, TaskStatus } from '@cloudtask/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** tasks table (spec §7). Status/priority are varchars validated in the app and
 * by CHECK constraints (created in the migration) — never Postgres enums. */
@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30 })
  status!: TaskStatus;

  @Column({ type: 'varchar', length: 20 })
  priority!: TaskPriority;

  // TypeORM maps the `date` type to a 'YYYY-MM-DD' string.
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
