// 语图技术方案 - 上下文组装器(分段 Token 预算,Task 10.4)
// 文档(context.md):Prompt = 【system】 + 【user question】 + 【流程图 json】 + 【history】
//   history = last K(近期原文,K=3) + summary(长期摘要,1~3条) + 向量检索(相关片段,2~5条)
// 分段预算(输入总量卡 maxTokens 的 80%):
//   记忆 40% / 项目 20% / 用户输入 15% / 工具结果 10% / system 10% / 工具定义 5%
//   每段超限即截断;未用完的配额按优先级借给超限段(总量不突破 80%)。
// 实体保真段(sessionEntitySlot)不参与截断(memory.md:压缩叙事不压缩事实)。
// 按意图差异化组装:generate 注入 FlowDraft schema;modify 额外注入带 ID 的画布语义摘要;consult 不注入。
// 重要信息放输入开头/结尾(lost-in-the-middle 缓解)。
import { Injectable } from '@nestjs/common';
import { IntentType } from '../schemas/chat.schema';
import { FlowNode, CanvasNode } from '../schemas/node.schema';
import { TokenBudget } from './token-budget';

export interface ContextInput {
  query: string;
  intent: IntentType;
  canvas?: CanvasNode[];
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  summaries: string[]; // 长期摘要
  retrieved: string[]; // 向量检索片段
  systemPrompt: string;
  /** 会话实体保真段(sessionEntitySlot.render 输出),不参与截断 */
  entities?: string;
  /** 项目上下文(项目名/领域说明等,命名空间限定在 projectId 内) */
  projectContext?: string;
  /** 工具定义文本(白名单工具的 name+description) */
  toolDefinitions?: string;
  /** 工具执行结果(如 template_match / validate_graph 输出) */
  toolResult?: string;
  /** 覆盖默认输入 token 上限(默认与 LLM 上下文窗口一致) */
  maxTokens?: number;
}

export interface BuiltContext {
  /** 最终拼装好的输入文本 */
  text: string;
  /** 各区块是否被裁剪(用于调试/日志/trace) */
  truncated: string[];
  tokenCount: number;
  /** 各分段实际占用 token 与分配上限(观测用) */
  segments: Record<ContextSegmentName, { used: number; limit: number }>;
}

const LAST_K = 3;
const SUMMARY_MAX = 3;
const RETRIEVED_MAX = 5;

/** 默认输入 token 上限(与 llm.factory 的模型上下文窗口对齐) */
export const DEFAULT_CONTEXT_MAX_TOKENS = 32000;

/** 分段预算比例(合计 1.0) */
export const CONTEXT_SEGMENT_RATIOS = {
  memory: 0.4,
  project: 0.2,
  userInput: 0.15,
  toolResult: 0.1,
  system: 0.1,
  toolDefinitions: 0.05,
} as const;

export type ContextSegmentName = keyof typeof CONTEXT_SEGMENT_RATIOS;

export const CONTEXT_SEGMENT_NAMES: ContextSegmentName[] = [
  'memory',
  'project',
  'userInput',
  'toolResult',
  'system',
  'toolDefinitions',
];

/** 配额借用优先级:用户输入与系统指令最先补足,工具定义最后 */
export const SEGMENT_BORROW_PRIORITY: ContextSegmentName[] = [
  'userInput',
  'system',
  'memory',
  'project',
  'toolResult',
  'toolDefinitions',
];

const TRUNCATE_MARK = '\n…[内容超预算已截断]';
/** 用户需求置尾重复的最大字符数(超长则不重复,避免浪费预算) */
export const TAIL_REPEAT_MAX_CHARS = 200;

/**
 * 计算各分段的字符预算:先按比例切分,再把未用满的配额按优先级借给超限段。
 * 纯函数,便于单测;总量恒不超过 totalBudget。
 */
export function allocateSegmentBudget(
  sizes: Partial<Record<ContextSegmentName, number>>,
  totalBudget: number,
  ratios: Record<ContextSegmentName, number> = CONTEXT_SEGMENT_RATIOS,
  priority: ContextSegmentName[] = SEGMENT_BORROW_PRIORITY,
): Record<ContextSegmentName, number> {
  const total = Math.max(0, Math.floor(totalBudget));
  const limits = {} as Record<ContextSegmentName, number>;
  for (const name of CONTEXT_SEGMENT_NAMES) {
    limits[name] = Math.floor(total * (ratios[name] ?? 0));
  }

  // 未用满的配额池(各段 min(size, limit) 之后的剩余)
  let spare = total;
  for (const name of CONTEXT_SEGMENT_NAMES) {
    const size = Math.max(0, Number(sizes[name]) || 0);
    spare -= Math.min(size, limits[name]);
  }
  spare = Math.max(0, spare);

  // 按优先级把剩余配额借给超限段
  for (const name of priority) {
    if (spare <= 0) break;
    const size = Math.max(0, Number(sizes[name]) || 0);
    const deficit = size - limits[name];
    if (deficit <= 0) continue;
    const grant = Math.min(deficit, spare);
    limits[name] += grant;
    spare -= grant;
  }
  return limits;
}

/** 按上限截断一段文本;keep='tail' 保留尾部(近期对话更重要) */
export function fitSegment(
  text: string,
  limit: number,
  keep: 'head' | 'tail' = 'head',
): { text: string; truncated: boolean } {
  const raw = text ?? '';
  if (!raw) return { text: '', truncated: false };
  const cap = Math.max(0, Math.floor(limit));
  if (TokenBudget.estimate(raw) <= cap) return { text: raw, truncated: false };
  const bodyCap = Math.max(0, cap - TokenBudget.estimate(TRUNCATE_MARK));
  const body = keep === 'tail' ? raw.slice(raw.length - bodyCap) : raw.slice(0, bodyCap);
  return {
    text: keep === 'tail' ? `${TRUNCATE_MARK}\n${body}` : `${body}${TRUNCATE_MARK}`,
    truncated: true,
  };
}

@Injectable()
export class ContextBuilder {
  build(input: ContextInput): BuiltContext {
    const maxTokens = input.maxTokens ?? DEFAULT_CONTEXT_MAX_TOKENS;
    // TokenBudget 内部即 maxTokens * 80%
    const budget = new TokenBudget(maxTokens);
    const totalBudget = budget.remaining();
    const truncated: string[] = [];

    // ---- 1. system 段:核心指令 + 按意图的输出格式引导(不可裁剪优先) ----
    const systemText = `【系统指令】\n${input.systemPrompt ?? ''}`;
    let schemaText = '';
    if (input.intent === 'generate') {
      schemaText = generateSchemaGuide();
    } else if (input.intent === 'modify') {
      schemaText = modifySchemaGuide();
    }
    const systemSegment = schemaText ? `${systemText}\n\n${schemaText}` : systemText;

    // ---- 2. 用户输入段:当前问题(重要,放开头靠近 system) ----
    const userInputSegment = `【用户需求】\n${input.query ?? ''}`;

    // ---- 3. 项目段:项目上下文 + 画布结构(仅 id/label/type) ----
    const projectParts: string[] = [];
    if (input.projectContext) projectParts.push(`【项目上下文】\n${input.projectContext}`);
    if (input.canvas?.length) {
      const canvasSummary = input.canvas.map((n) => `- ${n.id}: ${n.label}(${n.type})`).join('\n');
      projectParts.push(`【当前画布】\n${canvasSummary}`);
    } else if (input.intent === 'modify') {
      projectParts.push(`【当前画布】\n(空画布)`);
    }
    const projectSegment = projectParts.join('\n\n');

    // ---- 4. 记忆段:近期原文 + 历史摘要 + 检索片段 ----
    const memoryParts: string[] = [];
    const recent = (input.recentTurns ?? []).slice(-LAST_K);
    if (recent.length > 0) {
      memoryParts.push(
        `【近期对话】\n${recent.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n')}`,
      );
    }
    const summaries = (input.summaries ?? []).slice(-SUMMARY_MAX);
    if (summaries.length > 0) {
      memoryParts.push(`【历史摘要】\n${summaries.map((s) => `- ${s}`).join('\n')}`);
    }
    const retrieved = (input.retrieved ?? []).slice(0, RETRIEVED_MAX);
    if (retrieved.length > 0) {
      memoryParts.push(`【相关记忆】\n${retrieved.map((r) => `- ${r}`).join('\n')}`);
    }
    const memorySegment = memoryParts.join('\n\n');

    // ---- 5. 工具定义段 / 工具结果段 ----
    const toolDefinitionsSegment = input.toolDefinitions
      ? `【可用工具】\n${input.toolDefinitions}`
      : '';
    const toolResultSegment = input.toolResult ? `【工具结果】\n${input.toolResult}` : '';

    // ---- 6. 实体保真段:不参与截断 ----
    const entitySegment = input.entities ?? '';

    // ---- 7. 分段预算 + 逐段截断 ----
    const rawSegments: Record<ContextSegmentName, string> = {
      memory: memorySegment,
      project: projectSegment,
      userInput: userInputSegment,
      toolResult: toolResultSegment,
      system: systemSegment,
      toolDefinitions: toolDefinitionsSegment,
    };
    const limits = allocateSegmentBudget(
      {
        memory: TokenBudget.estimate(memorySegment),
        project: TokenBudget.estimate(projectSegment),
        userInput: TokenBudget.estimate(userInputSegment),
        toolResult: TokenBudget.estimate(toolResultSegment),
        system: TokenBudget.estimate(systemSegment),
        toolDefinitions: TokenBudget.estimate(toolDefinitionsSegment),
      },
      totalBudget,
    );

    const fitted = {} as Record<ContextSegmentName, string>;
    const segments = {} as BuiltContext['segments'];
    for (const name of CONTEXT_SEGMENT_NAMES) {
      // 记忆段保留尾部(最近的对话更重要),其余保留头部
      const result = fitSegment(rawSegments[name], limits[name], name === 'memory' ? 'tail' : 'head');
      fitted[name] = result.text;
      segments[name] = { used: TokenBudget.estimate(result.text), limit: limits[name] };
      if (result.truncated) truncated.push(name);
    }

    // ---- 8. 组装:重要信息置首尾(lost-in-the-middle 缓解) ----
    // 用户需求同时置首置尾(短问题才重复,lost-in-the-middle 缓解)
    const queryText = (input.query ?? '').trim();
    const tailQuery =
      queryText && queryText.length <= TAIL_REPEAT_MAX_CHARS
        ? `【再次确认用户需求】\n${queryText}`
        : '';

    const parts = [
      fitted.system,
      fitted.userInput,
      entitySegment,
      fitted.project,
      fitted.toolDefinitions,
      fitted.memory,
      fitted.toolResult,
      tailQuery,
    ].filter(Boolean);

    const finalText = parts.join('\n\n');
    return {
      text: finalText,
      truncated,
      tokenCount: TokenBudget.estimate(finalText),
      segments,
    };
  }
}

// FlowDraft schema 引导(generate 场景)
function generateSchemaGuide(): string {
  return `【输出格式】请按以下 JSON 结构输出(只输出 JSON,不要多余文字):
{
  "nodes": [ { "id": "n1", "label": "节点名称", "type": "start|end|process|decision|io|subprocess" } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "label": "可选" } ]
}
节点类型说明:
- start 开始 / end 结束 / process 处理步骤 / decision 判断 / io 输入输出 / subprocess 子流程
要求:
1. 必须包含 start 和 end
2. decision 节点必须有两条及以上分支
3. 节点与边的 id 全局唯一
4. 流程必须从 start 可达 end,无断头节点`;
}

// ModifyPatchOutput schema 引导(modify 场景)
function modifySchemaGuide(): string {
  // 画布结构由「项目段」统一注入(带 id/label/type),此处仅给输出格式约束
  return `【输出格式】请按以下 JSON 结构输出操作序列(只输出 JSON,不要多余文字):
{
  "operations": [
    { "op": "modify_node", "target": { "type": "node", "oldLabel": "旧名称" }, "semantic": { "label": "新名称" } },
    { "op": "modify_node", "target": { "type": "node", "oldLabel": "旧名称" }, "visual": { "fillColor": "#F5222D" } },
    { "op": "add_node", "semantic": { "label": "新节点", "nodeType": "process" }, "position": { "relativeTo": { "label": "参照节点" }, "direction": "bottom" } },
    { "op": "add_edge", "semantic": { "source": "n1", "target": "n2" }, "label": "可选" },
    { "op": "delete_node", "target": { "type": "node", "oldLabel": "节点名" } },
    { "op": "delete_edge", "target": { "type": "edge", "source": "n1", "target": "n2" } },
    { "op": "reposition", "target": { "type": "node", "oldLabel": "节点名" }, "position": { "relativeTo": { "label": "参照节点" }, "direction": "right" } }
  ]
}
约束:
1. target 必须引用画布中已存在的节点
2. visual 仅允许字段: borderStyle(solid|dashed|dotted)、borderWidth(1~5)、fillColor(#RRGGBB)、fontColor(#RRGGBB)、fontSize(12|14|16|18|20)
3. 删除操作必须同时考虑关联边`;
}
