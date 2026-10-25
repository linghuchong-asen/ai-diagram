// 语图技术方案 - 反思循环控制器
// 文档:反思失败 → Rewriter 局部修正(循环),循环控制器控制重试次数与终止条件
export interface LoopControlOptions {
  maxRetries: number; // 最大重试次数
}

export const DEFAULT_LOOP_CONTROL: LoopControlOptions = {
  maxRetries: 2, // 最多修正 2 次,超出则终止(避免死循环)
};

export class LoopController {
  private retries = 0;
  private readonly maxRetries: number;

  constructor(options: LoopControlOptions = DEFAULT_LOOP_CONTROL) {
    this.maxRetries = options.maxRetries;
  }

  /** 是否允许再次重试 */
  canRetry(): boolean {
    return this.retries < this.maxRetries;
  }

  /** 消耗一次重试机会 */
  consume(): number {
    return ++this.retries;
  }

  reset(): void {
    this.retries = 0;
  }

  get retryCount(): number {
    return this.retries;
  }
}
