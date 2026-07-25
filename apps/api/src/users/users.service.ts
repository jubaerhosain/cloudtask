import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  /** Case-insensitive lookup matching the lower(email) unique index. */
  findByEmailNormalized(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .where('lower(user.email) = lower(:email)', { email })
      .getOne();
  }

  create(input: CreateUserInput): Promise<User> {
    return this.repo.save(this.repo.create(input));
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }
}
