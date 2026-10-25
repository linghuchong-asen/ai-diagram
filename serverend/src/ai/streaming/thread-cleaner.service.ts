// 语图技术方案 - 线程定时清理服务(Task 9.4)
// 背景:ThreadStore 是进程内存储,线程记录若只增不删会随请求量线性膨胀。
// 方案:项目未引入 @nestjs/schedule,这里用 setInterval + unref() 自建轻量定时器:
//   - 每 CLEAN_INTERVAL_MS(5 分钟)扫描一次;
//   - 清理超过 THREAD_TTL_MS(30 分钟)未更新且无订阅者的线程;
//   - unref() 保证定时器不阻止进程退出(测试/优雅停机场景);
//   - OnModuleDestroy 时 clearInterval,避免热重启后定时器叠加。
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ThreadStore } from './thread.store';
import { ToolContextStore } from '../tools/tool-context.store';
import { CheckpointService } from '../memory/short-term/checkpoint.memory';

/** 清理周期:5 分钟 */
export const CLEAN_INTERVAL_MS = 5 * 60 * 1000;
/** 线程存活时间:30 分钟(超过且无人订阅即清理) */
export const THREAD_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class ThreadCleanerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThreadCleanerService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly threadStore: ThreadStore,
    private readonly toolContextStore: ToolContextStore,
    private readonly checkpoints: CheckpointService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // 定时回调兜底:任何异常都不允许打断下一次调度或冒泡为 uncaughtException
      try {
        this.cleanOnce();
      } catch (err) {
        this.logger.error(`线程定时清理失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
    }, CLEAN_INTERVAL_MS);
    // 不阻止进程退出
    this.timer?.unref?.();
    this.logger.log(`线程清理定时器已启动: 每 ${CLEAN_INTERVAL_MS / 60000} 分钟清理超 ${THREAD_TTL_MS / 60000} 分钟的线程`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.log('线程清理定时器已停止');
    }
  }

  /** 执行一次清理(定时与手动均可调用) */
  cleanOnce(): number {
    const removed = this.threadStore.cleanupOlderThan(THREAD_TTL_MS, (threadId) => {
      // 线程记录已回收,其短期记忆 checkpoint 同步清理(内存后端无 TTL,防进程内无界增长)
      void this.checkpoints.clear(threadId).catch((err) => {
        this.logger.warn(`清理线程 checkpoint 失败 thread=${threadId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
    // 工具多轮上下文同样有过期条目,顺带兜底清理
    const removedContexts = this.toolContextStore.cleanupExpired();
    if (removed > 0 || removedContexts > 0) {
      this.logger.log(
        `清理过期线程 ${removed} 条(当前 ${this.threadStore.size})、过期工具上下文 ${removedContexts} 条(当前 ${this.toolContextStore.size})`,
      );
    }
    return removed;
  }
}
