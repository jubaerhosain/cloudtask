import { LoginRequest, LoginResponse, RegisterRequest, UserPublic } from '@cloudtask/contracts';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { JwtPayload } from './jwt-payload';
import { PasswordService } from './password.service';
import { assertFound } from '../common/ownership/ownership.util';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; driverError?: { code?: string } })?.code;
  const driverCode = (err as { driverError?: { code?: string } })?.driverError?.code;
  return code === PG_UNIQUE_VIOLATION || driverCode === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterRequest): Promise<UserPublic> {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const user = await this.users.create({
        email,
        passwordHash,
        displayName: dto.displayName.trim(),
      });
      return AuthService.toPublic(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  async login(dto: LoginRequest): Promise<LoginResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findByEmailNormalized(email);
    const valid = user ? await this.passwords.verify(user.passwordHash, dto.password) : false;

    // Identical response whether the user is missing or the password is wrong,
    // to avoid account enumeration.
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    return { accessToken, expiresIn: 3600, user: AuthService.toPublic(user) };
  }

  /** Returns the authenticated user's public profile (404 if it no longer exists). */
  async getProfile(userId: string): Promise<UserPublic> {
    const user = assertFound(await this.users.findById(userId), 'User not found');
    return AuthService.toPublic(user);
  }

  private static toPublic(user: User): UserPublic {
    return { id: user.id, email: user.email, displayName: user.displayName };
  }
}
