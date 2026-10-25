// 语图商业化首发 - 增长事件埋点服务(Task 4 基础设施)
// 设计:增长/变现漏斗事件(register/generate/share_create/unlock_pay...)统一写单行 info 日志,
//       由日志采集侧按固定前缀 `GROWTH_EVENT ` grep 聚合 —— 不引入新依赖,零成本落地。
// 位置:ObservabilityModule 为 @Global,服务注册其 providers/exports 后,
//       任何模块可直接注入,无需改动各业务模块 imports 或 app.module.ts。
import { Injectable } from '@nestjs/common';
import { customLogger } from '../utils/log/logger.service';

@Injectable()
export class GrowthEventService {
  /**
   * 记录一次增长事件。
   * 日志格式严格为:GROWTH_EVENT {"event":...,"ts":"ISO",...props}(单行、前缀固定,
   * 后续 grep 聚合依赖此格式,不得偏离)。埋点是旁路:任何异常静默吞掉,绝不影响主链路。
   */
  track(event: string, props: Record<string, unknown> = {}): void {
    try {
      const line = `GROWTH_EVENT ${JSON.stringify({ event, ts: new Date().toISOString(), ...props })}`;
      customLogger.log(line, 'GrowthEvent');
    } catch {
      // 序列化失败等极端情况:静默,埋点绝不影响业务
    }
  }
}
