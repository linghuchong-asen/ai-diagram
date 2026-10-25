import { Controller, Delete, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { TraceService } from './trace.service';
import { JwtAuthGuard } from 'src/auth/auth.guard';

/**
 * 轨迹查询接口:
 *   GET    /observability/trace/:threadId  单次执行的完整轨迹 + 聚合指标
 *   GET    /observability/traces           最近轨迹列表
 *   DELETE /observability/traces/expired   清理过期轨迹(保留期见 TRACE_RETENTION_DAYS)
 */
@Controller('observability')
@UseGuards(JwtAuthGuard)
export class ObservabilityController {
  constructor(private readonly traceService: TraceService) {}

  @Get('trace/:threadId')
  async getTrace(@Param('threadId') threadId: string) {
    const trace = await this.traceService.getTrace(threadId);
    if (!trace) {
      throw new NotFoundException(`未找到 threadId=${threadId} 的执行轨迹`);
    }
    return trace;
  }

  @Get('traces')
  async listTraces(@Query('limit') limit?: string) {
    const parsed = parseInt(String(limit), 10);
    return this.traceService.listRecent(Number.isFinite(parsed) ? parsed : 20);
  }

  @Delete('traces/expired')
  async cleanup(@Query('days') days?: string) {
    const parsed = parseInt(String(days), 10);
    return this.traceService.cleanupExpired(Number.isFinite(parsed) ? parsed : undefined);
  }
}
