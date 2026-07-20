import { loginRequestSchema } from '@cloudtask/contracts';
import { createZodDto } from 'nestjs-zod';

export class LoginDto extends createZodDto(loginRequestSchema) {}
