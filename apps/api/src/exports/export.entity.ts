import { ExportStatus } from '@cloudtask/contracts';
import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** exports table (spec §7). Tracks an async CSV export job. */
@Entity('exports')
export class ExportJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: ExportStatus;

  @Column({ name: 's3_bucket', type: 'varchar', length: 255, nullable: true })
  s3Bucket!: string | null;

  @Column({ name: 's3_key', type: 'text', nullable: true })
  s3Key!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
