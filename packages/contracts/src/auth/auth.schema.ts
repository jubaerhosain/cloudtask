import { z } from 'zod';

/** Registration request body (spec §6.1). */
export const registerRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  displayName: z.string().trim().min(1).max(120),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Login request body. */
export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Public representation of a user — never includes the password hash. */
export const userPublicSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

/** Login response (spec §6.1). */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.literal(3600),
  user: userPublicSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
