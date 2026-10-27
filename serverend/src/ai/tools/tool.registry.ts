// 语图技术方案 - 工具统一注册中心(Task 8.1 / 8.2 / 8.6)
// 文档:工具调用统一抽象为「提示词工程 + 适配层」(RAG/Function Call/Skill/MCP)。
// 职责边界:
//   - Registry:工具「注册表 + 参数契约 + 原子实现」(只关心怎么执行一个工具);
//   - Executor:统一出口(白名单校验 / zod 参数校验 / 重试 / 脱敏 / 结果封顶 / 归一化)。
// 白名单说明:layout 工具已移除(原 layout.tool.ts 已删除) —— 布局由前端转换层程序化生成。
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { TemplateMatcher } from './template-matcher';
import { ValidatorTool } from './validator.tool';
import { StructuredToolError, ToolErrorClassifier } from './error.classifier';
// competitor-driven-evolution-batch Round 13:template_match 按形态分库匹配(formHint 白名单复用)
import { ArtifactFormHintSchema } from '../schemas/artifact.schema';

export interface ToolCallSpec {
  name: string; // 工具名
  params: Record<string, unknown>; // 已反序列化参数
  raw: string; // 原始调用文本
  /** 多轮工具上下文 id(Task 8.5) */
  contextId?: string;
  /** 所属线程(用于上下文按 thread 清理) */
  threadId?: string;
}

export interface ToolExecutionResult {
  name: string;
  ok: boolean;
  data?: unknown;
  error?: StructuredToolError;
}

/** 单个工具的注册项:参数 zod 契约 + 执行函数 */
export interface ToolDefinition<TParams = any, TData = any> {
  name: string;
  description: string;
  paramsSchema: z.ZodType<TParams>;
  /** 只读执行:不修改任何外部状态(上下文写入由 Executor 统一负责) */
  run: (params: TParams, ctx: { contextId?: string; threadId?: string }) => Promise<TData> | TData;
}

/** template_match 参数契约(Round 13:artifactKind 缺省 = flowchart,与结果契约一致) */
export const TemplateMatchParamsSchema = z.object({
  query: z.string().min(1, 'query 不能为空').max(2000, 'query 过长'),
  artifactKind: ArtifactFormHintSchema.optional(),
});

/** validate_graph 参数契约 */
export const ValidateGraphParamsSchema = z.object({
  draft: z.union([z.record(z.string(), z.any()), z.string()]).describe('待校验的 FlowDraft 或其 JSON 字符串'),
});

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly classifier = new ToolErrorClassifier();
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly templateMatcher: TemplateMatcher,
    private readonly validatorTool: ValidatorTool,
  ) {
    this.registerBuiltinTools();
  }

  /** 白名单:只有这里登记过的工具才可被调用(layout 已移除) */
  get whitelist(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 注册点:后续可扩展 RAG / Function Call / MCP 适配器 */
  register(def: ToolDefinition): void {
    this.tools.set(def.name, def);
  }

  private registerBuiltinTools(): void {
    // 内置 Skill:模板匹配(命中即短路,确定性程序优先)
    // Round 13:全形态模板库——flowchart 返回 draft(FlowDraft),新形态返回 artifactKind + artifact(产物本体)
    this.register({
      name: 'template_match',
      description:
        '按用户描述匹配内置模板(流程图:请假审批/费用报销;清单:会议待办;表格:技术选型;时间线:三天两晚行程;导图:读书笔记);有定制需求则不命中',
      paramsSchema: TemplateMatchParamsSchema,
      run: (params: z.infer<typeof TemplateMatchParamsSchema>) => {
        const result = this.templateMatcher.match(params.query, params.artifactKind);
        if (result.matched && result.template) {
          return {
            matched: true,
            templateId: result.template.id,
            templateName: result.template.name,
            draft: result.template.draft,
          };
        }
        if (result.matched && result.artifactTemplate) {
          return {
            matched: true,
            templateId: result.artifactTemplate.id,
            templateName: result.artifactTemplate.name,
            artifactKind: result.artifactTemplate.artifactKind,
            artifact: result.artifactTemplate.draft,
          };
        }
        return { matched: false };
      },
    });

    // 校验工具:接到 graph.validator.ts 真实实现(Task 8.6)
    this.register({
      name: 'validate_graph',
      description: '对 FlowDraft 执行两层确定性校验(Zod 格式 + 图遍历结构),返回结构化问题列表',
      paramsSchema: ValidateGraphParamsSchema,
      run: (params: z.infer<typeof ValidateGraphParamsSchema>) => {
        const draft = typeof params.draft === 'string' ? safeJsonParse(params.draft) : params.draft;
        return this.validatorTool.validate(draft);
      },
    });
  }

  /**
   * 原子执行:参数 zod 校验 → 调用实现 → 错误结构化。
   * 注意:重试 / 脱敏 / 结果封顶 / 上下文写入由 ToolExecutor 负责,这里保持「薄」。
   */
  async execute(call: ToolCallSpec): Promise<ToolExecutionResult> {
    const def = this.tools.get(call.name);
    if (!def) {
      return {
        name: call.name,
        ok: false,
        error: {
          status: 'error',
          error_type: 'fail',
          message_for_llm: `未知工具: ${call.name}`,
          suggestion: 'fallback',
        },
      };
    }

    // 参数 zod 校验:失败归类为 param,由上层回传模型自修正
    const parsed = def.paramsSchema.safeParse(call.params ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ');
      return {
        name: call.name,
        ok: false,
        error: {
          status: 'error',
          error_type: 'param',
          message_for_llm: `工具 ${call.name} 参数不合法: ${detail}。请修正参数后重试。`,
          suggestion: 'model-correct',
        },
      };
    }

    try {
      // 多轮上下文:若调用带 contextId,把上一次产出注入(只读),供工具实现按需使用
      const data = await def.run(parsed.data, {
        contextId: call.contextId,
        threadId: call.threadId,
      });
      this.logger.debug(`工具执行成功: ${call.name}`);
      return { name: call.name, ok: true, data };
    } catch (err) {
      this.logger.warn(`工具执行异常: ${call.name} - ${err instanceof Error ? err.message : String(err)}`);
      return { name: call.name, ok: false, error: this.classifier.classify(err) };
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
