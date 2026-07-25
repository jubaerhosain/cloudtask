import { z } from 'zod';

/** Allowed task status/priority values (enforced in app + CHECK constraints,
 * never as a Postgres enum type — spec §6.3). */
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** 'YYYY-MM-DD' date string. */
const dateString = z.string().date();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default('medium'),
  dueDate: dateString.nullish(),
});
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullish(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueDate: dateString.nullish(),
  })
  .partial();
export type UpdateTaskRequest = z.infer<typeof updateTaskSchema>;

/** Query params for listing tasks. Values arrive as strings, so page/limit
 * are coerced. */
export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueFrom: dateString.optional(),
  dueTo: dateString.optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskResponse = z.infer<typeof taskResponseSchema>;

export const taskListResponseSchema = z.object({
  items: z.array(taskResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

/** Project task summary (spec §6.4). */
export const projectSummarySchema = z.object({
  projectId: z.string().uuid(),
  total: z.number().int(),
  todo: z.number().int(),
  inProgress: z.number().int(),
  done: z.number().int(),
  generatedAt: z.string(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
