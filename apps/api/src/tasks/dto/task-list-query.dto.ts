import { taskListQuerySchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class TaskListQueryDto extends createZodDto(taskListQuerySchema) {}
