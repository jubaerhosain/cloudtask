import { Controller, HttpException, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Dev-only failure injection (spec §6.8). This controller is only registered
 * when ENABLE_FAILURE_ENDPOINTS=true (see AppModule) and is protected by the
 * global JWT guard. Used to exercise ALB 5xx metrics and alarms.
 */
@ApiTags('debug')
@Controller('debug')
export class DebugController {
  @Post('fail')
  fail(@Query('type') type?: string): never {
    const status = Number(type);
    const code = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    throw new HttpException(`Injected failure with status ${code}`, code);
  }
}
