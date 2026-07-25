import { createProjectSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
