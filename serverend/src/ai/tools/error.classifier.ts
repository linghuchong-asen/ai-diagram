// 语图技术方案 - 工具错误结构化
// 文档:失败分 网络/参数/重试 三级处理并结构化错误防幻觉。
//   network:代码层重试(指数退避,最多 3 次)
//   param:参数错误,拼修正提示返回模型自修正(最多 3 次)
//   重试仍失败 → 降级(System Prompt 引导)
export type ToolErrorType = 'network' | 'param' | 'fail';

export interface StructuredToolError {
  status: 'error';
  error_type: ToolErrorType;
  message_for_llm: string; // 给 LLM 看的修正提示
  suggestion?: string; // 给上层编排的建议
}

export class ToolErrorClassifier {
  /** 根据异常判定错误类型 */
  classify(err: unknown): StructuredToolError {
    const msg = err instanceof Error ? err.message : String(err);

    // 网络/超时/连接类错误 → network
    if (/ECONN|ETIMEDOUT|timeout|socket|connect|network|请求超时|网络/i.test(msg)) {
      return {
        status: 'error',
        error_type: 'network',
        message_for_llm: '工具调用出现网络错误,请稍后重试。',
        suggestion: 'code-retry',
      };
    }

    // 参数不合法类错误 → param
    if (/param|参数|invalid|schema|zod|validation|格式/i.test(msg)) {
      return {
        status: 'error',
        error_type: 'param',
        message_for_llm: `工具参数不合法: ${msg}。请修正参数后重试。`,
        suggestion: 'model-correct',
      };
    }

    // 其他 → fail(降级)
    return {
      status: 'error',
      error_type: 'fail',
      message_for_llm: `工具执行失败: ${msg}`,
      suggestion: 'fallback',
    };
  }

  /** 是否允许代码层重试 */
  shouldCodeRetry(error: StructuredToolError): boolean {
    return error.error_type === 'network';
  }
}
