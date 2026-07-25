import { createTaskSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTaskDto extends createZodDto(createTaskSchema) {}
