import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** projects table (spec §7). FK + the (owner_id, created_at desc) index are
 * created in the migration. */
@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
