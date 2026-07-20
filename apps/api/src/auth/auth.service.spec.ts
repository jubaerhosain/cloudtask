import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'HASHED',
    displayName: 'User One',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<Pick<UsersService, 'findByEmailNormalized' | 'create' | 'findById'>>;
  let passwords: jest.Mocked<Pick<PasswordService, 'hash' | 'verify'>>;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync'>>;

  beforeEach(() => {
    users = { findByEmailNormalized: jest.fn(), create: jest.fn(), findById: jest.fn() };
    passwords = { hash: jest.fn(), verify: jest.fn() };
    jwt = { signAsync: jest.fn() };
    service = new AuthService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      jwt as unknown as JwtService,
    );
  });

  describe('register', () => {
    it('normalizes the email, trims the name, and returns a public user without the hash', async () => {
      passwords.hash.mockResolvedValue('HASHED');
      users.create.mockResolvedValue(makeUser());

      const result = await service.register({
        email: 'USER@Example.com ',
        password: 'longenoughpassword',
        displayName: '  User One  ',
      });

      expect(users.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'HASHED',
        displayName: 'User One',
      });
      expect(result).toEqual({ id: 'user-1', email: 'user@example.com', displayName: 'User One' });
      expect(result as Record<string, unknown>).not.toHaveProperty('passwordHash');
    });

    it('maps a Postgres unique violation to 409 Conflict', async () => {
      passwords.hash.mockResolvedValue('HASHED');
      users.create.mockRejectedValue({ code: '23505' });

      await expect(
        service.register({ email: 'a@b.com', password: 'longenoughpassword', displayName: 'A' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('recognizes the violation on the wrapped driverError too', async () => {
      passwords.hash.mockResolvedValue('HASHED');
      users.create.mockRejectedValue({ driverError: { code: '23505' } });

      await expect(
        service.register({ email: 'a@b.com', password: 'longenoughpassword', displayName: 'A' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows unexpected errors', async () => {
      passwords.hash.mockResolvedValue('HASHED');
      users.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.register({ email: 'a@b.com', password: 'longenoughpassword', displayName: 'A' }),
      ).rejects.toThrow('boom');
    });
  });

  describe('login', () => {
    it('returns an access token, expiresIn 3600, and the public user for valid credentials', async () => {
      users.findByEmailNormalized.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);
      jwt.signAsync.mockResolvedValue('TOKEN');

      const result = await service.login({ email: 'USER@Example.com', password: 'secret' });

      expect(result).toEqual({
        accessToken: 'TOKEN',
        expiresIn: 3600,
        user: { id: 'user-1', email: 'user@example.com', displayName: 'User One' },
      });
      expect(jwt.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'user@example.com' },
        { algorithm: 'HS256', expiresIn: '1h' },
      );
    });

    it('throws a generic 401 and does not check the password when the user is missing', async () => {
      users.findByEmailNormalized.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@x.com', password: 'secret' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(passwords.verify).not.toHaveBeenCalled();
    });

    it('throws a generic 401 when the password is wrong', async () => {
      users.findByEmailNormalized.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);

      await expect(service.login({ email: 'user@example.com', password: 'nope' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });
});
