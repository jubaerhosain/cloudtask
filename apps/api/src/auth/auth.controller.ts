import { LoginResponse, UserPublic } from '@cloudtask/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/types';
import { RateLimit } from '../ratelimit/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto): Promise<UserPublic> {
    return this.auth.register(dto);
  }

  @Public()
  // Login attempts: 10 per 5 minutes per IP (spec §6.6).
  @RateLimit({ name: 'login', limit: 10, windowSec: 300, keyBy: 'ip' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive an access token' })
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserPublic> {
    return this.auth.getProfile(user.userId);
  }
}
