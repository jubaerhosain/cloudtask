import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an argon2id hash that does not contain the plaintext', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery');
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await service.hash('correct horse battery');
    expect(await service.verify(hash, 'correct horse battery')).toBe(true);
    expect(await service.verify(hash, 'wrong password')).toBe(false);
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await service.verify('not-a-valid-hash', 'anything')).toBe(false);
  });
});
