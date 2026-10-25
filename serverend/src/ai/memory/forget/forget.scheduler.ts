// 语图技术方案 - 遗忘曲线定时扫描(Task 10.3)
// 背景:长期记忆需要按遗忘曲线周期性衰减,项目未引入 @nestjs/schedule,
// 参照 streaming/thread-cleaner.service.ts 用 setInterval + unref() 自建轻量定时器。
// 策略:
//   - 每 FORGET_SCAN_INTERVAL_MS(7 天)扫描一次全部长期记忆;
//   - 启动后 FORGET_SCAN_STARTUP_DELAY_MS(1 分钟)做一次首扫,避免刚部署时积压;
//   - unref() 保证定时器不阻止进程退出(测试/优雅停机);
//   - 压缩器可选:LLM 不可用时退化为"仅标记 compressed"。
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { LlmFactory } from '../../adapters/llm.factory';
import { compressPrompt } from '../../prompts/compress.prompt';
import { LongTermMemoryService } from '../long-term/long-term.store';
import {
  DEFAULT_FORGETTING_POLICY,
  ForgettingCurveService,
  MemoryCompressor,
  ScanResult,
} from './forgetting.curve';
import { MemoryRecord } from '../long-term/long-term.store';

/** 扫描周期:7 天 */
export const FORGET_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** 启动首扫延迟:1 分钟 */
export const FORGET_SCAN_STARTUP_DELAY_MS = 60 * 1000;
/** 压缩超时:8 秒(LLM 慢则退化为规则截断) */
const COMPRESS_TIMEOUT_MS = 8 * 1000;

/** LLM 压缩器:把待压缩记忆摘要成短文本,失败返回 null(由调用方保留原文) */
export class LlmMemoryCompressor implements MemoryCompressor {
  private readonly logger = new Logger(LlmMemoryCompressor.name);

  constructor(private readonly llmFactory: LlmFactory) {}

  async compress(record: MemoryRecord): Promise<string> {
    if (!this.llmFactory.isAvailable()) return null;
    const source = record.summary || record.content;
    if (!source) return null;
    try {
      const llm = this.llmFactory.getModels().medium;
      const prompt = await compressPrompt.format({
        history: `[记忆条目] ${source.slice(0, 1200)}`,
      });
      const response = await withTimeout(llm.invoke(prompt), COMPRESS_TIMEOUT_MS);
      const text = typeof response === 'string' ? response : response?.content;
      const output = typeof text === 'string' ? text.trim() : '';
      if (!output) return null;
      return output.slice(0, 600);
    } catch (error) {
      this.logger.warn(`记忆压缩失败,保留原文: ${error?.message ?? error}`);
      return null;
    }
  }
}

/** 超时保护:计时器随 race 结果清理,避免遗留 rejected promise 触发 unhandledRejection */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`compress timeout(${ms}ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

@Injectable()
export class ForgettingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForgettingScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private compressor?: MemoryCompressor;

  constructor(
    private readonly forgettingCurve: ForgettingCurveService,
    private readonly longTermMemory: LongTermMemoryService,
    @Optional() llmFactory?: LlmFactory,
  ) {
    if (llmFactory) this.compressor = new LlmMemoryCompressor(llmFactory);
  }

  onModuleInit(): void {
    this.startupTimer = setTimeout(() => {
      void this.runOnce();
    }, FORGET_SCAN_STARTUP_DELAY_MS);
    this.startupTimer?.unref?.();

    this.timer = setInterval(() => {
      void this.runOnce();
    }, FORGET_SCAN_INTERVAL_MS);
    this.timer?.unref?.();

    this.logger.log(
      `遗忘曲线定时器已启动: 每 ${Math.round(FORGET_SCAN_INTERVAL_MS / 3600000)} 小时扫描一次长期记忆`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = undefined;
    this.startupTimer = undefined;
  }

  /** 手动触发一次扫描(定时与测试均可调用) */
  async runOnce(): Promise<ScanResult> {
    try {
      const store = this.longTermMemory.getStore();
      const result = await this.forgettingCurve.runWeeklyScan(
        store,
        DEFAULT_FORGETTING_POLICY,
        this.compressor,
      );
      if (result.scanned > 0) {
        this.logger.log(
          `遗忘曲线扫描完成: 共 ${result.scanned} 条,保留 ${result.kept}、压缩 ${result.toCompress}、删除 ${result.deleted}`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(`遗忘曲线扫描失败: ${error?.message ?? error}`);
      return { scanned: 0, kept: 0, toCompress: 0, deleted: 0 };
    }
  }
}
