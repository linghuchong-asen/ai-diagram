// 语图技术方案 - LangGraph 状态图编排
// 节点:意图识别 → 上下文组装 → 工具(template_match) → 生成/修改 → 反思 → 工具;条件边 + 循环 + 重试
// 本实现提供轻量状态机(遵循 LangGraph StateGraph 语义):
//   节点函数更新状态,条件边决定下一个节点,循环(反思失败→Rewriter)由控制器控制。
// 若 @langchain/langgraph 可用,可无缝迁移到官方 StateGraph。
// Task 8.1:工具调用一律经 ToolExecutor 统一出口(白名单 + zod + 重试 + 封顶 + 归一化)。
// Task 9.2:反思修正超限不再直接报错,转「人在回路」挂起,由前端确认后续跑。
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AgentState, createInitialState } from './state';
import { IntentRecognizer } from '../intent/intent.recognizer';
import { ContextBuilder } from '../context/context.builder';
import { ReflectionEvaluator, ReflectionIssue } from '../reflection/evaluator';
import { Rewriter } from '../reflection/rewriter';
import { LoopController } from '../reflection/loop.controller';
import { ToolExecutor } from '../tools/tool-executor';
import { ToolRegistry } from '../tools/tool.registry';
import { ToolResult } from '../tools/tool.types';
import { LlmFactory } from '../adapters/llm.factory';
import { SYSTEM_PROMPT, anchorSystemPrompt } from '../prompts/system.prompt';
import { buildGeneratePrompt } from '../prompts/generate.prompt';
import { buildModifyPrompt } from '../prompts/modify.prompt';
import { GENERIC_ERROR_PROMPT } from '../prompts/fallback.prompt';
// Task 11.6:Prompt 注入防御 —— 意图识别前做输入模式过滤(命中清洗或拒绝)
import { INJECTION_REFUSAL, filterUserInput } from '../security/prompt-injection';
// Task 10.5:实体槽 ingest 需要把结构化结果序列化为文本(复用 error-sanitizer 的循环引用兜底序列化)
import { safeStringify } from '../tools/error-sanitizer';
import { FlowDraftSchema, FlowDraft } from '../schemas/flow-draft.schema';
import { ModifyPatchOutputSchema, ModifyPatchOutput } from '../schemas/patch.schema';
import { CheckpointService, TOPIC_SHIFT_KEEP_MESSAGES } from '../memory/short-term/checkpoint.memory';
import { RollingSummaryService } from '../memory/short-term/rolling-summary.service';
import { LongTermMemoryService } from '../memory/long-term/long-term.store';
import { SessionEntitySlotService } from '../memory/entity-slot';
import { detectTopicShift, detectTopicShiftByKeywords, MIN_MESSAGES_FOR_SHIFT, SHIFT_WINDOW } from '../memory/topic-shift';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../memory/embedding.provider';
import { extractKeywordsLite } from '../memory/keywords.util';
import { RollingSummaryOutcome } from '../memory/short-term/rolling-summary.service';
// Task 13.1:轻量 trace 埋点(观测层),@Optional 注入,未装配时全链路 no-op
import { TraceService } from '../../observability/trace.service';
import { TRACE_STEPS } from '../../observability/trace.types';

export interface GraphRunOptions {
  onThinkingToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface GraphRunResult {
  state: AgentState;
}

/**
 * 状态图节点:意图识别
 * 规则优先(80%+ 场景)→ 模型兜底;只做路由决策。
 */
@Injectable()
export class FlowStateGraph {
  private readonly logger = new Logger(FlowStateGraph.name);

  constructor(
    private readonly intentRecognizer: IntentRecognizer,
    private readonly contextBuilder: ContextBuilder,
    private readonly reflection: ReflectionEvaluator,
    private readonly rewriter: Rewriter,
    private readonly toolExecutor: ToolExecutor,
    private readonly llmFactory: LlmFactory,
    private readonly checkpoints: CheckpointService,
    private readonly longTermMemory: LongTermMemoryService,
    private readonly rollingSummary: RollingSummaryService,
    private readonly entitySlot: SessionEntitySlotService,
    private readonly toolRegistry: ToolRegistry,
    // Task 10.2/10.5:embedding provider 可插拔;未装配或不可用时向量路与话题切换自动退化
    @Optional() @Inject(EMBEDDING_PROVIDER) private readonly embedder?: EmbeddingProvider,
    /**
     * Task 13.1:@Optional() 注入 TraceService。ObservabilityModule 为 @Global,
     * 因此这里无需改动 ai.module.ts;未装配时所有埋点自动退化为 no-op。
     */
    @Optional() private readonly traceService?: TraceService,
  ) {}

  /** 运行完整状态图 */
  async run(initial: Partial<AgentState>, options: GraphRunOptions = {}): Promise<GraphRunResult> {
    let state = createInitialState(initial);
    const loop = new LoopController({ maxRetries: state.maxRewrites });
    const runStartedAt = Date.now();
    let contextTokens = 0;
    await this.traceService?.startRun({
      threadId: state.threadId,
      sessionId: state.sessionId,
      projectId: state.projectId,
      query: state.query,
      canvasNodeCount: state.canvas?.length ?? 0,
    });

    try {
      // ---- 节点 0:Prompt 注入过滤(Task 11.6,security.md 输入安全) ----
      // 命中 reject 级注入模式 → 不进模型,直接返回受控话术(不消耗 token);
      // 仅命中 strip 级 → 剔除可疑句后放行,保留正常需求。
      const injection = filterUserInput(state.query);
      if (injection.action === 'reject') {
        this.logger.warn(
          `检测到 Prompt 注入,已拦截: thread=${state.threadId}, patterns=${injection.hits.join(',')}`,
        );
        state.injectionHits = injection.hits;
        // 不设 state.error:错误态会以受控话术(结果体)返回前端,避免内部码外泄
        state.result = { kind: 'error', message: INJECTION_REFUSAL };
        await this.traceService?.recordStep({
          threadId: state.threadId,
          stepName: TRACE_STEPS.INTENT,
          status: 'fail',
          input: state.query,
          output: 'blocked_by_injection_filter',
          startedAt: runStartedAt,
          usageSource: 'none',
          errorType: 'prompt_injection',
          meta: { patterns: injection.hits },
        });
        await this.finishTrace(state, runStartedAt, 0, new Error('prompt_injection_blocked'));
        return { state };
      }
      if (injection.action === 'sanitize') {
        this.logger.warn(
          `用户输入含可疑句已清洗后放行: thread=${state.threadId}, patterns=${injection.hits.join(',')}`,
        );
        state.injectionHits = injection.hits;
        state.query = injection.text;
      }

      // ---- 节点 1:意图识别(规则优先 → medium 模型兜底,Task 7) ----
      const hasCanvas = (state.canvas?.length ?? 0) > 0;
      const intentStartedAt = Date.now();
      // Task 3 免登录试用:startTrial 预置 intent(强制 generate)时跳过识别,不消耗 token
      const intent = state.intent
        ? {
            intent: state.intent,
            source: 'rule' as const,
            confidence: 1,
            reasons: ['preset(trial)'],
            llmAttempted: false,
          }
        : await this.intentRecognizer.recognize({
            query: state.query,
            signals: {
              hasCanvas,
              canvasNodes: state.canvas?.length ?? 0,
              hasSelection: false,
              query: state.query,
            },
          });
      state.intent = intent.intent;
      state.intentSource = intent.source;
      state.intentConfidence = intent.confidence;
      state.intentReasons = intent.reasons;
      state.intentUsage = intent.usage;
      this.logger.debug(
        `意图识别: ${state.intent} (source=${intent.source}, confidence=${intent.confidence}, usage=${JSON.stringify(
          intent.usage ?? null,
        )})`,
      );
      await this.traceService?.recordStep({
        threadId: state.threadId,
        stepName: TRACE_STEPS.INTENT,
        status: 'ok',
        input: state.query,
        output: state.intent,
        startedAt: intentStartedAt,
        usage: intent.usage,
        usageSource: intent.usage ? 'actual' : 'none',
        meta: {
          source: intent.source,
          confidence: intent.confidence,
          reasons: intent.reasons,
          hasCanvas,
        },
      });
      await this.traceService?.updateRun(state.threadId, {
        intent: state.intent,
        intentSource: state.intentSource,
      });

      // ---- 节点 2:上下文组装(按意图差异化) ----
      const contextStartedAt = Date.now();
      const recentTurns = state.sessionId ? await this.loadRecentTurns(state) : [];
      const summaries = state.sessionId ? await this.loadSummaries(state) : [];
      const retrievedOutcome = state.sessionId
        ? await this.loadRetrieved(state)
        : { texts: [], degraded: [] };
      const retrieved = retrievedOutcome.texts;
      const retrievedDegraded = retrievedOutcome.degraded;
      const built = this.contextBuilder.build({
        // 恢复执行时把用户补充的约束拼到 query 后面(Task 9.5 人在回路)
        query: state.resumeInstruction
          ? `${state.query}\n【用户补充约束】${state.resumeInstruction}`
          : state.query,
        intent: state.intent,
        canvas: state.canvas,
        recentTurns,
        summaries,
        retrieved,
        systemPrompt: anchorSystemPrompt(SYSTEM_PROMPT), // Task 11.6:首尾角色锚定包装
        // Task 10.5:实体保真段(sessionEntitySlot),不参与截断
        entities: state.sessionId ? this.entitySlot.render(state.sessionId) : '',
        // Task 10.4:项目段(命名空间限定在 projectId 内)
        projectContext: state.projectId ? `projectId: ${state.projectId}` : '',
        // Task 10.4:工具定义段(白名单工具 name+description)
        toolDefinitions: this.renderToolDefinitions(),
      });
      state.contextText = built.text;
      state.contextTruncated = built.truncated;
      state.contextSegments = built.segments;
      state.memoryDegraded = retrievedDegraded;
      contextTokens = built.tokenCount ?? 0;
      await this.traceService?.recordStep({
        threadId: state.threadId,
        stepName: TRACE_STEPS.CONTEXT,
        status: 'ok',
        input: {
          intent: state.intent,
          canvasNodes: state.canvas?.length ?? 0,
          recentTurns: recentTurns.length,
          summaries: summaries.length,
          retrieved: retrieved.length,
        },
        output: built.truncated?.length ? `truncated: ${built.truncated.join(',')}` : undefined,
        startedAt: contextStartedAt,
        usageSource: 'none',
        meta: {
          tokenCount: built.tokenCount,
          truncated: built.truncated ?? [],
          // Task 10.4/10.2:分段预算占用与记忆检索降级原因(观测字段)
          segments: built.segments,
          memoryDegraded: retrievedDegraded ?? [],
        },
      });
      await this.traceService?.updateRun(state.threadId, { contextTokens });

      // ---- 节点 3:工具调用(template_match,generate 场景预检;Task 8.1) ----
      if (state.intent === 'generate') {
        const toolResult = await this.callTool('template_match', { query: state.query }, state);
        const data = toolResult.data as { matched?: boolean; draft?: FlowDraft } | undefined;
        state.templateMatched = toolResult.status === 'ok' && data?.matched === true;
        if (state.templateMatched && data?.draft) {
          // 模板命中直接短路返回(确定性程序优先,不消耗大模型 token)
          this.logger.log(`模板命中短路: 直接使用内置模板结构,跳过 LLM 生成`);
          state.draft = data.draft;
          state.reflectionValid = true;
          state.result = { kind: 'generate', flowDraft: data.draft };
          await this.persistTurn(state);
          await this.finishTrace(state, runStartedAt, contextTokens);
          return { state };
        }
        // 未命中/失败:继续走 LLM 生成(失败时工具已返回受控降级话术,不影响主链路)
      }

      // ---- 节点 4:生成/修改(LLM 调用,CoT 流式) ----
      if (state.intent === 'consult') {
        state.consultAnswer = await this.runConsult(state, options);
        state.result = { kind: 'consult', answer: state.consultAnswer };
      } else {
        await this.generateWithRewrite(state, loop, options);
      }

      // ---- 节点 5:落记忆(工具重试/参数修正已在 ToolExecutor 内闭环) ----
      await this.persistTurn(state);
      await this.finishTrace(state, runStartedAt, contextTokens);
      return { state };
    } catch (err: any) {
      // 主动中断不收尾:轨迹留在 running,聚合时按 incomplete 处理
      if (err?.name === 'AbortError') throw err;
      this.logger.error(`状态图执行失败: ${err?.message}`, err?.stack);
      // 内部细节不外泄:日志留原文,返回给前端的是脱敏固定话术
      state.error = err?.message ?? 'unknown';
      state.result = { kind: 'error', message: GENERIC_ERROR_PROMPT };
      await this.finishTrace(state, runStartedAt, contextTokens, err);
      return { state };
    }
  }

  /**
   * 工具统一出口调用(Task 8.1/8.2):所有工具都从这里走,保证
   *   白名单校验 + 参数 zod 校验 + 分级重试 + 结果封顶 + 日志可观测。
   */
  private async callTool(name: string, params: Record<string, unknown>, state: AgentState): Promise<ToolResult> {
    const toolStartedAt = Date.now();
    const result = await this.toolExecutor.execute({
      name,
      params,
      threadId: state.threadId,
    });
    state.toolResult = result;
    state.toolCalls = [
      ...(state.toolCalls ?? []),
      {
        tool: result.tool,
        status: result.status,
        error_type: result.error_type,
        contextId: result.contextId,
      },
    ];
    this.logger.log(
      `工具调用: ${name} → ${result.status}${result.error_type ? `(${result.error_type})` : ''} | ${result.message_for_llm}`,
    );
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.TOOL_CALL,
      status: result.status === 'ok' ? 'ok' : 'fail',
      input: { tool: name, params },
      output: result.message_for_llm,
      startedAt: toolStartedAt,
      usage: result.usage,
      usageSource: result.usage ? 'actual' : 'none',
      errorType: result.error_type,
      meta: {
        tool: name,
        status: result.status,
        error_type: result.error_type,
        contextId: result.contextId,
      },
    });
    return result;
  }

  /** 生成 → 反思 → 失败则 Rewriter 局部修正(循环,最多 maxRewrites 次);超限转人在回路(Task 9.2) */
  private async generateWithRewrite(
    state: AgentState,
    loop: LoopController,
    options: GraphRunOptions,
  ): Promise<void> {
    let raw = '';
    /** 最后一次「格式合法」的产出:作为人在回路的候选方案 1 */
    let lastDraft: FlowDraft | undefined;
    let lastPatch: ModifyPatchOutput | undefined;

    while (true) {
      raw = await this.callLlm(state, options, loop.retryCount);
      state.rawOutput = raw;

      if (state.intent === 'modify') {
        const validateStartedAt = Date.now();
        const parsed = await this.parseModifyOutput(raw);
        if (parsed.ok) {
          lastPatch = parsed.patch;
          state.patch = parsed.patch;
          state.reflectionValid = true;
          state.result = { kind: 'modify', operations: parsed.patch!.operations };
          await this.recordReflection(state, 'modify', validateStartedAt, { passed: true });
          return;
        }
        const issues: ReflectionIssue[] = [
          { layer: 'format', severity: 'error', message: parsed.error ?? 'JSON 解析失败' },
        ];
        await this.recordReflection(state, 'modify', validateStartedAt, {
          passed: false,
          blocking: issues,
          layer: 'format',
        });
        if (!loop.canRetry()) {
          // 超限 → 人在回路挂起(Task 9.2),不再直接返回 error
          await this.suspendForHumanConfirm(state, 'modify', issues, undefined, lastPatch);
          return;
        }
        loop.consume();
        state.rewriteCount = loop.retryCount;
        state.reflectionIssues = issues;
        // Rewriter 局部修正:注入失败原因重新生成(不重走完整主流程)
        state.contextText = this.rewriter.buildCorrectionPrompt({
          intent: 'modify',
          rawOutput: raw,
          issues,
          canvasSummary: state.canvas?.map((n) => `- ${n.id}: ${n.label}(${n.type})`).join('\n'),
        });
        await this.recordRewrite(state, 'modify', issues);
        continue;
      }

      // generate 场景:两层确定性校验(Zod + 图遍历)
      const validateStartedAt = Date.now();
      const parsed = await this.parseGenerateOutput(raw);
      if (parsed.ok) {
        lastDraft = parsed.draft;
        const reflection = this.reflection.evaluate({ kind: 'generate', draft: parsed.draft! });
        await this.recordReflection(state, 'generate', validateStartedAt, {
          passed: reflection.valid,
          blocking: reflection.blockingIssues,
          warnings: reflection.warnings,
          layer: 'structure',
        });
        if (reflection.valid) {
          state.draft = parsed.draft;
          state.reflectionValid = true;
          // warning(如合法回环 HAS_CYCLE)随结果透出,但不阻断
          state.reflectionIssues = reflection.warnings;
          state.result = { kind: 'generate', flowDraft: parsed.draft };
          return;
        }
        const issues = reflection.blockingIssues;
        if (!loop.canRetry()) {
          await this.suspendForHumanConfirm(state, 'generate', issues, lastDraft, undefined);
          return;
        }
        loop.consume();
        state.rewriteCount = loop.retryCount;
        state.reflectionIssues = issues;
        state.contextText = this.rewriter.buildCorrectionPrompt({
          intent: 'generate',
          rawOutput: raw,
          issues,
          draftSummary: summarizeDraft(lastDraft),
        });
        await this.recordRewrite(state, 'generate', issues);
        continue;
      }

      const issues: ReflectionIssue[] = [
        { layer: 'format', severity: 'error', message: parsed.error ?? 'JSON 解析失败' },
      ];
      await this.recordReflection(state, 'generate', validateStartedAt, {
        passed: false,
        blocking: issues,
        layer: 'format',
      });
      if (!loop.canRetry()) {
        await this.suspendForHumanConfirm(state, 'generate', issues, lastDraft, undefined);
        return;
      }
      loop.consume();
      state.rewriteCount = loop.retryCount;
      state.reflectionIssues = issues;
      state.contextText = this.rewriter.buildCorrectionPrompt({
        intent: 'generate',
        rawOutput: raw,
        issues,
        draftSummary: summarizeDraft(lastDraft),
      });
      await this.recordRewrite(state, 'generate', issues);
    }
  }

  /**
   * 修正超限 → 转「人在回路」(Task 9.2 / 9.5)
   * 状态置为挂起:不产出最终 result,由 ai.service 写入 need_confirm 供前端确认,
   * 前端 POST /ai/confirm/:threadId 后恢复执行。
   */
  private async suspendForHumanConfirm(
    state: AgentState,
    intent: 'generate' | 'modify',
    issues: ReflectionIssue[],
    lastDraft?: FlowDraft,
    lastPatch?: ModifyPatchOutput,
  ): Promise<void> {
    state.reflectionValid = false;
    state.reflectionIssues = issues;
    state.needHumanConfirm = true;
    state.suspended = true;
    state.confirmPayload = this.rewriter.buildConfirmPayload({
      intent,
      issues,
      lastDraft,
      lastOperations: lastPatch?.operations,
      rewriteCount: state.rewriteCount,
      maxRewrites: state.maxRewrites,
    });
    this.logger.warn(
      `反思修正超限(${state.rewriteCount}/${state.maxRewrites}),转人在回路等待确认: ${issues
        .map((i) => i.message)
        .join('; ')}`,
    );
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.HUMAN_CONFIRM,
      status: 'ok',
      input: { intent, rewriteCount: state.rewriteCount, maxRewrites: state.maxRewrites },
      output: issues.map((i) => i.message).join('; '),
      usageSource: 'none',
      meta: { intent, issues: issues.length },
    });
    await this.traceService?.updateRun(state.threadId, {
      rewriteCount: state.rewriteCount,
    });
  }

  /** 调用 LLM:CoT 思考流式输出 token,最后返回完整文本(提示词统一由 prompts 模块出) */
  private async callLlm(state: AgentState, options: GraphRunOptions, attempt = 0): Promise<string> {
    const models = this.llmFactory.getModels();
    const llm = models.large;
    // Task 9.3:generate / modify 分别走各自的提示词构造器,不在编排层手拼 role
    const messages =
      state.intent === 'modify'
        ? buildModifyPrompt({ context: state.contextText! })
        : buildGeneratePrompt({ context: state.contextText! });

    let full = '';
    // 思考流:记录 <thinking>...</thinking> 区间内的 token
    let inThinking = false;
    const llmStartedAt = Date.now();
    const stream = await llm.stream(messages as any);
    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content);
      full += text;

      // 仅把思考过程(token)推入 SSE;结果 JSON 走 result 一次性拉取
      const idx = text.indexOf('</thinking>');
      if (inThinking) {
        const push = idx >= 0 ? text.slice(0, idx) : text;
        if (push) options.onThinkingToken?.(push);
      }
      if (text.includes('<thinking>')) inThinking = true;
      if (idx >= 0) inThinking = false;
    }
    // 适配层未透出真实 usage:按输出长度估算并标注 source='estimate'
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.GENERATE,
      status: full ? 'ok' : 'fail',
      input: { intent: state.intent, attempt, contextLength: state.contextText?.length ?? 0 },
      output: full,
      startedAt: llmStartedAt,
      errorType: full ? undefined : 'empty_response',
      meta: { intent: state.intent, attempt, model: 'large' },
    });
    return full;
  }

  /** consult 场景:中模型回答 */
  private async runConsult(state: AgentState, options: GraphRunOptions): Promise<string> {
    const models = this.llmFactory.getModels();
    const consultStartedAt = Date.now();
    const stream = await models.medium.stream([{ role: 'user', content: state.contextText! }]);
    let full = '';
    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content);
      full += text;
      options.onThinkingToken?.(text);
    }
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.CONSULT,
      status: full ? 'ok' : 'fail',
      input: { intent: state.intent },
      output: full,
      startedAt: consultStartedAt,
      errorType: full ? undefined : 'empty_response',
      meta: { model: 'medium' },
    });
    return full;
  }

  /**
   * 调用级输出硬上限的字符换算(Task 11.5):max_tokens 硬上限由 adapters 层(LLM maxTokens)执行;
   * 这里对「已完成输出」做长度复核 —— 中文场景 1 token≈1 字符,JSON 混排取 2 倍容差。
   * 超长按格式问题处理 → 走既有反思/Rewriter 重试链路(security.md:超长截断并触发反思重试)。
   */
  private get maxOutputChars(): number {
    return Math.max(1024, this.llmFactory.getMaxOutputTokens() * 2);
  }

  private async parseGenerateOutput(raw: string): Promise<{ ok: boolean; draft?: FlowDraft; error?: string }> {
    if (raw && raw.length > this.maxOutputChars) {
      return { ok: false, error: `输出超长(${raw.length} 字符 > 上限 ${this.maxOutputChars}),已按格式问题拦截` };
    }
    const json = extractJson(raw);
    if (!json) return { ok: false, error: '未找到合法 JSON' };
    try {
      const draft = JSON.parse(json) as FlowDraft;
      const parsed = FlowDraftSchema.safeParse(draft);
      return parsed.success ? { ok: true, draft: parsed.data } : { ok: false, error: parsed.error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'JSON 解析失败' };
    }
  }

  private async parseModifyOutput(raw: string): Promise<{ ok: boolean; patch?: ModifyPatchOutput; error?: string }> {
    if (raw && raw.length > this.maxOutputChars) {
      return { ok: false, error: `输出超长(${raw.length} 字符 > 上限 ${this.maxOutputChars}),已按格式问题拦截` };
    }
    const json = extractJson(raw);
    if (!json) return { ok: false, error: '未找到合法 JSON' };
    try {
      const patch = JSON.parse(json) as ModifyPatchOutput;
      const parsed = ModifyPatchOutputSchema.safeParse(patch);
      return parsed.success ? { ok: true, patch: parsed.data } : { ok: false, error: parsed.error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'JSON 解析失败' };
    }
  }

  // ---------- 记忆接入 ----------
  private async loadRecentTurns(state: AgentState) {
    const cp = await this.checkpoints.get(state.threadId);
    return cp?.messages ?? [];
  }

  private async loadSummaries(state: AgentState) {
    const records = await this.longTermMemory.listForSession(state.sessionId ?? state.threadId);
    return records.slice(-3).map((r) => r.summary ?? r.content);
  }

  /**
   * 长期记忆召回(Task 10.2):双路召回 → RRF top-10 → Reranker top-3。
   * 返回 texts + degraded:降级原因(embedding/rerank 不可用)写入 state.memoryDegraded 供观测。
   * 检索失败不阻塞主链路:异常时退化为空召回并记录降级原因。
   */
  private async loadRetrieved(
    state: AgentState,
  ): Promise<{ texts: string[]; degraded: Array<{ stage: string; reason: string }> }> {
    try {
      const result = await this.longTermMemory.searchWithMeta({
        sessionId: state.sessionId ?? state.threadId,
        projectId: state.projectId,
        query: state.query,
        topK: 5,
      });
      return {
        texts: (result.records ?? []).map((r) => r.summary ?? r.content).filter(Boolean),
        degraded: result.degraded ?? [],
      };
    } catch (err: any) {
      this.logger.warn(`长期记忆召回失败,退化为空召回: ${err?.message ?? err}`);
      return { texts: [], degraded: [{ stage: 'memory', reason: `召回失败: ${err?.message ?? 'unknown'}` }] };
    }
  }

  /**
   * 工具定义段(Task 10.4):渲染白名单工具的 name + description,占上下文预算 5%。
   * 只渲染注册中心里登记过的工具,避免把不可调用的工具暴露给模型。
   */
  private renderToolDefinitions(): string {
    try {
      const names = this.toolRegistry?.whitelist ?? [];
      const lines = names
        .map((name) => {
          const def = this.toolRegistry.getDefinition(name);
          return def ? `- ${def.name}: ${def.description}` : `- ${name}`;
        })
        .filter(Boolean);
      return lines.length ? lines.join('\n') : '';
    } catch (err: any) {
      this.logger.warn(`工具定义渲染失败,跳过该段: ${err?.message ?? err}`);
      return '';
    }
  }

  private async persistTurn(state: AgentState) {
    const persistStartedAt = Date.now();
    // 短期:每轮落 State(Task 10.1 Checkpointer)
    await this.checkpoints.saveTurn(state.threadId, 'user', state.query);
    if (state.result) {
      await this.checkpoints.saveTurn(state.threadId, 'assistant', JSON.stringify(state.result));
    }

    // Task 10.5:实体保真槽 —— 压缩叙事不压缩事实,角色/命名/硬约束单独存,注入上下文时不截断
    const assistantText = state.result ? safeStringify(state.result) : '';
    if (state.sessionId) {
      try {
        this.entitySlot.ingest(state.sessionId, `${state.query}\n${assistantText}`);
      } catch (err: any) {
        this.logger.warn(`实体槽写入失败(不阻塞主链路): ${err?.message ?? err}`);
      }
    }

    // Task 10.5:话题切换检测(向量优先,无向量退化关键词 Jaccard)
    const shift = await this.detectTopicShiftForThread(state);
    state.topicShifted = shift.shifted;

    // Task 10.1:每 2 轮触发滚动摘要(LLM 不可用时服务内部退化为规则摘要)
    const summary = await this.safeSummarize(state);

    // 话题切换后 trim 旧话题原文:仅在已有摘要承接时裁剪,避免丢事实
    let trimmed = 0;
    if (shift.shifted && (summary?.summarized || (await this.hasSummary(state.threadId)))) {
      trimmed = await this.checkpoints.trimMessages(state.threadId, TOPIC_SHIFT_KEEP_MESSAGES);
    }

    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.PERSIST,
      status: 'ok',
      input: { threadId: state.threadId, hasResult: !!state.result },
      startedAt: persistStartedAt,
      usageSource: 'none',
      meta: {
        resultKind: (state.result as { kind?: string })?.kind,
        saver: this.checkpoints.getSaverName(),
        // Task 10.1/10.5:滚动摘要与话题切换的观测字段
        summarized: !!summary?.summarized,
        summarySource: summary?.source,
        summaryDegraded: summary?.degradedReason,
        topicShifted: shift.shifted,
        topicShiftSimilarity: shift.similarity ?? null,
        topicShiftReason: shift.reason,
        trimmedMessages: trimmed,
        memoryDegraded: state.memoryDegraded ?? [],
      },
    });
  }

  /** 滚动摘要旁路执行:异常不冒泡,保证主链路始终能收尾 */
  private async safeSummarize(state: AgentState): Promise<import('../memory/short-term/rolling-summary.service').RollingSummaryOutcome | undefined> {
    if (!state.sessionId) return undefined;
    try {
      return await this.rollingSummary.maybeSummarize(state.sessionId, state.threadId, state.projectId);
    } catch (err: any) {
      this.logger.warn(`滚动摘要异常(不阻塞主链路): ${err?.message ?? err}`);
      return undefined;
    }
  }

  private async hasSummary(threadId: string): Promise<boolean> {
    try {
      return !!(await this.checkpoints.get(threadId))?.lastSummary;
    } catch {
      return false;
    }
  }

  /**
   * 话题切换检测(Task 10.5):
   *  - 消息数不足 MIN_MESSAGES_FOR_SHIFT 时直接判定「未切换」,不消耗 embedding;
   *  - embedder 可用 → 对最近 6 条消息取向量,按「最近 3 条均值 vs 之前 3 条均值」算余弦,阈值 0.5;
   *  - embedder 不可用/向量缺失 → 用 extractKeywordsLite 的关键词集合算 Jaccard 兜底(阈值同为 0.5)。
   */
  private async detectTopicShiftForThread(state: AgentState) {
    const noop = { shifted: false, similarity: null as number | null, reason: 'skipped' };
    try {
      const messages = (await this.checkpoints.get(state.threadId))?.messages ?? [];
      if (messages.length < MIN_MESSAGES_FOR_SHIFT) {
        return { ...noop, reason: `消息数不足(${messages.length})` };
      }
      const window = messages.slice(-SHIFT_WINDOW * 2);
      const texts = window.map((m) => (m.content ?? '').slice(0, 1000));

      const vectors = await this.embedForTopicShift(texts);
      if (vectors && vectors.some((v) => Array.isArray(v) && v.length > 0)) {
        const result = detectTopicShift(vectors);
        if (result.similarity !== null) return result;
      }

      return detectTopicShiftByKeywords(texts.map((t) => extractKeywordsLite(t, { limit: 12 })));
    } catch (err: any) {
      this.logger.warn(`话题切换检测失败(按未切换处理): ${err?.message ?? err}`);
      return noop;
    }
  }

  /** 为话题切换取向量;embedding 不可用时返回 null(调用方走关键词兜底) */
  private async embedForTopicShift(texts: string[]): Promise<Array<number[] | null> | null> {
    if (!this.embedder || !this.embedder.available?.()) return null;
    try {
      return await this.embedder.embedDocuments(texts);
    } catch (err: any) {
      this.logger.warn(`话题切换向量获取失败,退化关键词兜底: ${err?.message ?? err}`);
      return null;
    }
  }

  // ---------- Task 13.1 trace 埋点辅助(全部为旁路,失败不影响主链路) ----------

  /** 轨迹收尾:聚合指标写回 header */
  private async finishTrace(
    state: AgentState,
    startedAt: number,
    contextTokens = 0,
    err?: unknown,
  ): Promise<void> {
    await this.traceService?.finishRun({
      threadId: state.threadId,
      status: err ? 'error' : state.suspended ? 'suspended' : 'ok',
      resultKind: (state.result as { kind?: string })?.kind,
      templateMatched: state.templateMatched,
      totalDurationMs: Date.now() - startedAt,
      rewriteCount: state.rewriteCount,
      contextTokens: contextTokens || undefined,
      error: err,
    });
  }

  /** 反思/格式校验结果埋点 */
  private async recordReflection(
    state: AgentState,
    kind: 'generate' | 'modify',
    startedAt: number,
    detail: {
      passed: boolean;
      blocking?: ReflectionIssue[];
      warnings?: ReflectionIssue[];
      layer?: 'format' | 'structure';
    },
  ): Promise<void> {
    const blocking = detail.blocking ?? [];
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.REFLECTION,
      status: detail.passed ? 'ok' : 'fail',
      input: { kind, layer: detail.layer },
      output: detail.passed ? 'valid' : blocking.map((i) => `${i.layer}:${i.message}`).join('; '),
      startedAt,
      usageSource: 'none',
      meta: {
        kind,
        layer: detail.layer,
        passed: detail.passed,
        blockingCount: blocking.length,
        warningCount: (detail.warnings ?? []).length,
      },
    });
  }

  /** Rewriter 局部修正埋点 */
  private async recordRewrite(
    state: AgentState,
    intent: 'generate' | 'modify',
    issues: ReflectionIssue[],
  ): Promise<void> {
    await this.traceService?.recordStep({
      threadId: state.threadId,
      stepName: TRACE_STEPS.REWRITE,
      status: 'ok',
      input: { intent, rewriteCount: state.rewriteCount, maxRewrites: state.maxRewrites },
      output: issues.map((i) => i.message).join('; '),
      usageSource: 'none',
      meta: { intent, rewriteCount: state.rewriteCount },
    });
    await this.traceService?.updateRun(state.threadId, { rewriteCount: state.rewriteCount });
  }
}

/** 从 LLM 输出中提取 JSON(容忍 markdown 代码块包裹) */
export function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

/**
 * 草稿结构摘要(供 Rewriter 做「局部修正」定位):只保留 id/label/type 与边的连接关系,
 * 不塞完整 JSON,避免修正提示词膨胀挤占 token 预算。
 */
export function summarizeDraft(draft?: FlowDraft): string | undefined {
  if (!draft) return undefined;
  const nodes = draft.nodes.map((n) => `- ${n.id}: ${n.label}(${n.type})`).join('\n');
  const edges = draft.edges.map((e) => `- ${e.id}: ${e.source} → ${e.target}${e.label ? `(${e.label})` : ''}`).join('\n');
  return `节点:\n${nodes || '(无)'}\n边:\n${edges || '(无)'}`;
}

