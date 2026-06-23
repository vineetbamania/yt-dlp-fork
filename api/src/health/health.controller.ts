import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  /** Authenticated detailed health check. */
  @Get('health')
  @ApiOperation({ summary: 'Authenticated health check (uptime).' })
  check(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Public liveness probe for platform health checks (Render, Fly, k8s).
   *  No secrets leak; just confirms the process is responsive.
   */
  @Public()
  @Get('healthz')
  @ApiOperation({ summary: 'Public liveness probe.' })
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
