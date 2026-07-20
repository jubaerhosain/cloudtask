import { updateProjectSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
