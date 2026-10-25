// 语图技术方案 - 工具统一出参契约(Task 8.2)
// 设计原则:
//   1) 归一化:所有工具(内置 Skill / 未来 RAG / Function Call / MCP)统一返回 ToolResult,上层只看 status;
//   2) 可解释:message_for_llm 是给模型的「下一步指令文本」,必须脱敏、必须有界;
//   3) 有界:data 必须经过封顶(数组 top-K / 字段白名单 / 字符串截断),防止撑爆上下文与 token 预算。
import { ToolErrorType } from './error.classifier';

/** 工具用量(仅涉及模型/外部计费的工具需要填充) */
export interface ToolUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 非 token 型计费(如检索条数、外部 API 调用次数) */
  calls?: number;
}

/** 统一工具出参 */
export interface ToolResult<T = unknown> {
  /** ok = 拿到可用数据;fail = 未拿到数据(含降级) */
  status: 'ok' | 'fail';
  /** 工具名(白名单内的名字) */
  tool: string;
  /** 成功时的数据(已封顶) */
  data?: T;
  /** 给模型看的摘要/修正指令:成功时为「怎么用」,失败时为「为什么失败 + 下一步怎么办」 */
  message_for_llm: string;
  /** 失败分级(仅 status='fail' 时有意义) */
  error_type?: ToolErrorType;
  /** 多轮工具上下文 id(Task 8.5):用于在同一 thread 内串联多次工具调用 */
  contextId?: string;
  /** 用量观测 */
  usage?: ToolUsage;
}

/** 数组结果封顶条数(Task 8.2) */
export const TOOL_RESULT_TOP_K = 5;
/** 字符串字段封顶长度(Task 8.2) */
export const TOOL_RESULT_MAX_STRING_LEN = 2000;
/** data 对象嵌套深度上限(防递归/防超大结构) */
export const TOOL_RESULT_MAX_DEPTH = 4;

/** 构造成功结果 */
export function okResult<T>(tool: string, data: T, message_for_llm: string, extra?: Partial<ToolResult<T>>): ToolResult<T> {
  return { status: 'ok', tool, data, message_for_llm, ...extra };
}

/** 构造失败结果 */
export function failResult(
  tool: string,
  message_for_llm: string,
  error_type: ToolErrorType = 'fail',
  extra?: Partial<ToolResult>,
): ToolResult {
  return { status: 'fail', tool, message_for_llm, error_type, ...extra };
}
