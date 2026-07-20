import { updateTaskSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
