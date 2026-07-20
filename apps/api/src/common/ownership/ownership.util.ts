import { NotFoundException } from '@nestjs/common';

/**
 * Returns the entity if present, otherwise throws 404.
 *
 * Ownership is enforced by scoping the query (e.g. `where: { id, ownerId }`),
 * so a resource owned by another user simply "isn't found" — this avoids
 * leaking existence via a 403 (spec §6.2).
 */
export function assertFound<T>(entity: T | null | undefined, message = 'Resource not found'): T {
  if (entity === null || entity === undefined) {
    throw new NotFoundException(message);
  }
  return entity;
}
