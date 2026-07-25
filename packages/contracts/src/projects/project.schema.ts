import { z } from 'zod';

/** Create project request (spec §6.2). */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(10_000).nullish(),
});
export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

/** Update project request — all fields optional. */
export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

/** Project as returned by the API (timestamps are ISO-8601 strings). */
export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
