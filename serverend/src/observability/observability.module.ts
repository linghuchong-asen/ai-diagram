import { Global, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceEntity } from './entities/trace.entity';
import { TraceStepEntity } from './entities/trace-step.entity';
import { ObservabilityController } from './observability.controller';
import { GrowthTrackController } from './growth-track.controller';
import { TraceService } from './trace.service';
import { GrowthEventService } from './growth-event.service';
import { TRACE_RETENTION_DAYS } from './trace.summarize';

/**
 * 轻量观测模块(13.1/13.2)：轨迹按 threadId 落 PostgreSQL，提供查询接口。
 * @Global() 是为了让 AiModule 中的 FlowStateGraph 能以 @Optional() 方式注入 TraceService，
 * 而不需要改动 AiModule 的 imports(禁区文件)。仍建议在 AppModule.imports 中显式引入本模块。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TraceEntity, TraceStepEntity])],
  controllers: [ObservabilityController, GrowthTrackController],
  // GrowthEventService:Task 4 增长事件埋点(register/generate/share_create...),
  // 经 @Global 导出后任何模块直接注入,业务模块无需各自 imports。
  providers: [TraceService, GrowthEventService],
  exports: [TraceService, GrowthEventService],
})
export class ObservabilityModule implements OnModuleInit, OnModuleDestroy {
  /* 每天清理一次过期轨迹，避免 ai_trace_step 无界增长 */
  private readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  private timer?: NodeJS.Timeout;

  constructor(private readonly traceService: TraceService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.traceService
        .cleanupExpired(TRACE_RETENTION_DAYS)
        .catch(() => undefined);
    }, this.CLEANUP_INTERVAL_MS);
    /* 定时器不应阻止进程退出 */
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
