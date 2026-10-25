// 语图技术方案 - Token 预算管理
// 文档:输入 token 卡 80% 上限;组合策略以控总量为主,控条数兜底。
// 参考:中文约 1 token/字,这里按字符数估算,留有余量。
export class TokenBudget {
  private maxTokens: number;
  private budget: number;

  constructor(maxTokens = 32000) {
    this.maxTokens = maxTokens;
    // 输入侧只允许用到 80%
    this.budget = Math.floor(maxTokens * 0.8);
  }

  /** 估算文本 token 数(中文为主场景:字符≈token) */
  static estimate(text: string): number {
    return Math.ceil(text.length);
  }

  remaining(): number {
    return this.budget;
  }

  /** 尝试追加一段内容,若超出预算返回 false 且不扣减 */
  tryAdd(text: string): boolean {
    const cost = TokenBudget.estimate(text);
    if (cost > this.budget) return false;
    this.budget -= cost;
    return true;
  }

  /** 强制追加(用于不可裁剪的核心指令),超限则截断 */
  forceAdd(text: string): string {
    const cost = TokenBudget.estimate(text);
    if (cost <= this.budget) {
      this.budget -= cost;
      return text;
    }
    const allowedChars = this.budget;
    this.budget = 0;
    return text.slice(0, allowedChars);
  }
}
