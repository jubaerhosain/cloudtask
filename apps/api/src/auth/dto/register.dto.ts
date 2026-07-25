import { registerRequestSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class RegisterDto extends createZodDto(registerRequestSchema) {}
