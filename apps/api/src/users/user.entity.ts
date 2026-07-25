import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** users table (spec §7). The unique index on lower(email) is created in the
 * migration as raw SQL (functional indexes can't be expressed via decorators). */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
