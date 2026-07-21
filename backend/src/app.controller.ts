import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Health check / root endpoint',
    description:
      'Returns a simple greeting message. Useful as a basic liveness probe.',
  })
  @ApiResponse({ status: 200, description: 'Service is up' })
  getHello(): string {
    return this.appService.getHello();
  }
}
