// 语图技术方案 - AI 编排服务
// 数据流:「思考流式 + 数据一次性」
//   1. POST /api/ai/chat -> { threadId }(立即返回,后台跑 LangGraph 状态图)
//   2. SSE  /api/ai/think/:threadId -> 逐 token 推送思考过程
//   3. GET  /api/ai/result/:threadId -> 202 + Retry-After 轮询,就绪返回完整数据
//   4. GET  /api/ai/result/:threadId -> 200 + status='need_confirm'(人在回路挂起,Task 9.5)
//   5. POST /api/ai/confirm/:threadId -> 提交确认后恢复执行(Task 9.5)
import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlowStateGraph } from './agents/graph';
import { AgentState } from './agents/state';
import { ThreadRecord, ThreadStore } from './streaming/thread.store';
import { ThinkStreamHub } from './streaming/think.stream';
import { ToolExecutor } from './tools/tool-executor';
import { CheckpointService } from './memory/short-term/checkpoint.memory';
import { LongTermMemoryService } from './memory/long-term/long-term.store';
import { UserProfileService } from './memory/profile/user.profile';
import { ChatRequest, AiResult, IntentType, TrialChatRequest } from './schemas/chat.schema';
import { CanvasNode } from './schemas/node.schema';
import { HumanConfirmPayload } from './reflection/rewriter';
import { QuotaService, todayKey } from './quota/quota.service';
// Task 4 增长埋点:ObservabilityModule 为 @Global,可直接注入
import { GrowthEventService } from '../observability/growth-event.service';

export interface ChatInitDto {
  userId?: string;
  message: string;
  canvas?: CanvasNode[];
  sessionId?: string;
  projectId?: string;
  /** Task 3 免登录试用:预置意图(强制 generate),graph 检测到后跳过意图识别 */
  intent?: IntentType;
  /** Task 3 免登录试用:匿名身份标识,生成完成的增长埋点携带 */
  trialId?: string;
}

/** 确认动作(Task 9.5):accept = 采用候选方案;retry = 补充约束后重跑 */
export type ConfirmChoice = 'accept' | 'retry';

export interface ConfirmDto {
  choice: ConfirmChoice;
  /** retry 时前端补充的约束(一句话) */
  instruction?: string;
  /** 指定候选方案 id;缺省按 choice 推断(accept → accept-current) */
  candidateId?: string;
  /** 恢复令牌:与挂起时下发的一致才允许恢复(防重复/伪造提交) */
  resumeToken?: string;
}

/** result 端点的统一视图(区分 执行中 / 就绪 / 挂起 / 失败 四态) */
export type ResultView =
  | { status: 'pending' }
  | { status: 'done'; data: AiResult }
  | { status: 'need_confirm'; data: HumanConfirmPayload }
  | { status: 'error'; message: string };

/** Task 3 免登录试用防线:单 IP 每日 3 次;全局每日默认 100(env AI_TRIAL_DAILY_GLOBAL_LIMIT 可覆盖) */
const TRIAL_PER_IP_PER_DAY = 3;
const DEFAULT_TRIAL_DAILY_GLOBAL_LIMIT = 100;
/** 试用台账记录上限(防进程内 Map 无界增长,超限时清理非当日记录;照抄限流 Guard 的 sweepExpired 模式) */
const MAX_TRIAL_LEDGER_KEYS = 10000;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /** 匿名台账:trialId → 当日已用次数(当日 TTL;单次试用,重启清零) */
  private readonly trialIdUsage = new Map<string, { day: string; used: number }>();
  /** IP 日台账:ip → 当日次数(防清 localStorage 换 trialId 刷) */
  private readonly trialIpUsage = new Map<string, { day: string; count: number }>();
  /** 全局日计数:当日全站试用总量(成本总闸) */
  private trialGlobalUsage = { day: '', count: 0 };

  constructor(
    private readonly graph: FlowStateGraph,
    private readonly threadStore: ThreadStore,
    private readonly thinkStream: ThinkStreamHub,
    private readonly toolExecutor: ToolExecutor,
    private readonly checkpoints: CheckpointService,
    private readonly longTermMemory: LongTermMemoryService,
    private readonly profiles: UserProfileService,
    /* Task 11.5:用户级每日配额 + 会话级软上限 */
    private readonly quota: QuotaService,
    /* Task 3:免登录试用全局上限读取 env AI_TRIAL_DAILY_GLOBAL_LIMIT */
    private readonly config: ConfigService,
    /* Task 4:增长埋点(generate 事件) */
    private readonly growthEvent: GrowthEventService,
  ) {}

  /** 1) 创建线程:立即返回 threadId,后台执行 LangGraph 状态图 */
  async createThread(dto: ChatInitDto): Promise<{ threadId: string }> {
    // Task 11.5:用户级每日配额闸门 —— 超限抛 429 QuotaExceededException(controller 透传)
    const userId = dto.userId ? String(dto.userId) : undefined;
    if (userId) {
      await this.quota.assertCanRun(userId);
    }

    const threadId = randomUUID();
    this.threadStore.create(threadId);
    this.logger.log(`创建 AI 线程: ${threadId}`);

    const sessionId = dto.sessionId ?? `${userId ?? 'anon'}:${dto.projectId ?? 'default'}`;

    // 后台异步执行,不阻塞响应
    void this.executeGraph(threadId, {
      threadId,
      sessionId,
      // Task 10.6/11.5:命名空间 —— 用户画像按 user_id(非 sessionId);配额按 user 计量
      userId,
      projectId: dto.projectId,
      query: dto.message,
      canvas: dto.canvas,
      // Task 3 免登录试用:预置意图 + 匿名身份(埋点携带);登录链路均为 undefined,行为不变
      intent: dto.intent,
      trialId: dto.trialId,
    });

    return { threadId };
  }

  /**
   * 1') Task 3 免登录单次试用:匿名跑一次 generate(无 canvas、不扣用户配额、不写 ai_daily_usage)。
   * 三层防线(均为进程内台账,重启清零 —— 单实例公测期可接受;多实例需换 Redis):
   *   1) trialId 当日已用 → 429 TRIAL_USED(同一匿名身份单次试用);
   *   2) 同 IP 当日 ≥3 次 → 429 TRIAL_BUSY(防清 localStorage 换 trialId 刷);
   *   3) 全局当日 ≥ AI_TRIAL_DAILY_GLOBAL_LIMIT(默认 100)→ 429 TRIAL_BUSY(全局成本总闸)。
   */
  async startTrial(dto: TrialChatRequest, ip: string): Promise<{ threadId: string }> {
    const day = todayKey();

    const idRecord = this.trialIdUsage.get(dto.trialId);
    if (idRecord?.day === day && idRecord.used >= 1) {
      throw new HttpException(
        { code: 'TRIAL_USED', message: '试用次数已用完，注册后每日可生成 3 次' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ipRecord = this.trialIpUsage.get(ip);
    if (ipRecord?.day === day && ipRecord.count >= TRIAL_PER_IP_PER_DAY) {
      throw new HttpException(
        { code: 'TRIAL_BUSY', message: '今日试用名额已满，注册立即可用' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      this.trialGlobalUsage.day === day &&
      this.trialGlobalUsage.count >= this.trialDailyGlobalLimit
    ) {
      throw new HttpException(
        { code: 'TRIAL_BUSY', message: '今日试用名额已满，注册立即可用' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 通过:三本台账各自记账(先清理过期记录,防 Map 无界增长)
    this.sweepTrialLedger(day);
    this.trialIdUsage.set(dto.trialId, { day, used: 1 });
    if (ipRecord?.day === day) {
      ipRecord.count += 1;
    } else {
      this.trialIpUsage.set(ip, { day, count: 1 });
    }
    if (this.trialGlobalUsage.day === day) {
      this.trialGlobalUsage.count += 1;
    } else {
      this.trialGlobalUsage = { day, count: 1 };
    }

    this.logger.log(`免登录试用开始: trialId=${dto.trialId}, ip=${ip}`);
    // 与 /chat 相同机制创建线程;强制 generate 意图保证试用必达核心价值(出图),
    // sessionId 以 trial: 前缀与正式会话隔离,userId 缺省 → 不扣配额、不写用量表
    return this.createThread({
      message: dto.message,
      intent: 'generate',
      trialId: dto.trialId,
      sessionId: `trial:${dto.trialId}`,
    });
  }

  /** 试用台账防膨胀:超过上限时清理非当日记录(当日 TTL) */
  private sweepTrialLedger(day: string): void {
    if (
      this.trialIdUsage.size < MAX_TRIAL_LEDGER_KEYS &&
      this.trialIpUsage.size < MAX_TRIAL_LEDGER_KEYS
    ) {
      return;
    }
    for (const [key, rec] of this.trialIdUsage) {
      if (rec.day !== day) this.trialIdUsage.delete(key);
    }
    for (const [key, rec] of this.trialIpUsage) {
      if (rec.day !== day) this.trialIpUsage.delete(key);
    }
  }

  /** 试用全局日上限(env AI_TRIAL_DAILY_GLOBAL_LIMIT 覆盖,默认 100) */
  private get trialDailyGlobalLimit(): number {
    const raw = Number(this.config.get('AI_TRIAL_DAILY_GLOBAL_LIMIT'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TRIAL_DAILY_GLOBAL_LIMIT;
  }

  /**
   * 后台执行状态图,并把 CoT token 推入思考流,结束时写入 result / need_confirm / error。
   * Task 9.4:无论成功、失败还是中断(转人在回路),finally 中一律 end(threadId),
   *          并释放该线程的工具上下文(挂起态除外,恢复执行还要复用)。
   */
  private async executeGraph(threadId: string, initial: Partial<AgentState>): Promise<void> {
    const emit = (token: string) => this.thinkStream.publish(threadId, token);
    let suspended = false;

    try {
      const { state } = await this.graph.run(initial, { onThinkingToken: emit });
      suspended = state.needHumanConfirm === true;

      // Task 11.5:配额计量 + 会话软上限(旁路,失败不影响主链路)
      // 注入拦截轮不计量(未消耗模型 token);错误轮也按实际产出计量
      let sessionNotice: string | undefined;
      if (state.userId && state.intent) {
        const usedTokens =
          (state.rawOutput?.length ?? 0) + (state.consultAnswer?.length ?? 0) + (state.query?.length ?? 0);
        await this.quota.consume(state.userId, state.intent, usedTokens);
        if (state.sessionId) {
          sessionNotice = this.quota.addSessionUsage(state.sessionId, usedTokens).notice;
        }
      }
      // 会话级软上限:接近阈值在最终结果附提示字段(Task 11.5)
      if (sessionNotice && state.result && (state.result as { kind?: string }).kind !== 'error') {
        (state.result as Record<string, unknown>).notice = sessionNotice;
      }

      // Task 4 增长埋点:一次有效生成完成 —— 真实 LLM 与模板兜底(template_match 短路)各算一次;
      // 匿名试用同样经此记录点(anon=true + trialId),确保匿名路径不漏。
      if (
        !suspended &&
        state.intent === 'generate' &&
        (state.result as { kind?: string } | undefined)?.kind === 'generate'
      ) {
        // 适配层未透出真实 usage:与 quota.consume 同源的长度估算作为本次消耗;
        // 模板命中短路未走 LLM 生成,记 0。
        const usedTokens =
          (state.rawOutput?.length ?? 0) +
          (state.consultAnswer?.length ?? 0) +
          (state.query?.length ?? 0);
        this.growthEvent.track('generate', {
          userId: state.userId ?? null,
          anon: !state.userId,
          trialId: state.userId ? undefined : state.trialId ?? null,
          threadId,
          intent: state.intent,
          mode: state.templateMatched ? 'template' : 'real',
          tokens: state.templateMatched ? 0 : usedTokens,
        });
      }

      // 短期记忆:每轮落 State(已在 graph.persistTurn 中处理)
      // 长期记忆:每 10 轮 / 会话结束异步写入(挂起时本次无产出,跳过)
      if (!suspended && state.intent && state.sessionId) {
        const turns = (await this.checkpoints.get(threadId))?.messages ?? [];
        if (turns.length % 10 === 0 || state.result) {
          await this.writeLongTerm(state.sessionId, state.projectId, turns);
        }
        // 用户画像:会话结束异步更新 —— 命名空间按 user_id(Task 10.6),无真实 userId 时跳过
        if (state.userId) {
          await this.profiles.ingestFromConversation(state.userId, turns);
        }
      }

      if (suspended) {
        // 中断态:反思修正超限 → 转人在回路,等待前端确认(Task 9.5)
        this.threadStore.setNeedConfirm(threadId, state.confirmPayload!, {
          resumeToken: randomUUID(),
          suspendedState: state,
        });
        this.logger.warn(`线程 ${threadId} 挂起等待用户确认`);
        return;
      }

      if (state.error) {
        this.threadStore.setError(threadId, state.error);
      } else if (state.result) {
        this.threadStore.setResult(threadId, state.result as AiResult);
      } else {
        this.threadStore.setError(threadId, 'AI 未产出结果');
      }
    } catch (e: any) {
      this.logger.error(`线程 ${threadId} 执行失败: ${e?.message}`, e?.stack);
      this.threadStore.setError(threadId, e?.message ?? 'AI 执行失败');
      // 异常路径:推送错误终态(内部已删通道,后面的 end 幂等无副作用)
      this.thinkStream.error(threadId, e?.message ?? 'AI 执行失败');
    } finally {
      // 全路径收尾(Task 9.4)
      this.thinkStream.end(threadId);
      if (!suspended) {
        this.toolExecutor.releaseThread(threadId);
      }
    }
  }

  /** 长期记忆写入:摘要 + 关键词 + (向量由 pgvector 后端完成) */
  private async writeLongTerm(
    sessionId: string,
    projectId: string | undefined,
    turns: Array<{ role: string; content: string }>,
  ): Promise<void> {
    const last = turns[turns.length - 1];
    if (!last) return;
    const keywords = this.extractKeywords(last.content);
    await this.longTermMemory.add({
      sessionId,
      projectId,
      content: last.content,
      summary: last.content.slice(0, 200),
      keywords,
      importance: 0.5,
    });
  }

  private extractKeywords(text: string): string[] {
    const domains = ['请假', '审批', '报销', '招聘', '开发', '部署', '注册', '登录', '下单', '退款', '测试', '发布', '审批流程', '流程'];
    return domains.filter((d) => text.includes(d));
  }

  /** 2) 思考流:SSE 逐 token */
  subscribeThink(threadId: string): Observable<MessageEvent> {
    const rec = this.threadStore.get(threadId);
    if (!rec) throw new NotFoundException('线程不存在');
    this.threadStore.addSubscriber(threadId);
    const source = this.thinkStream.toObservable(threadId);
    return new Observable<MessageEvent>((subscriber) => {
      const sub = source.subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        this.threadStore.removeSubscriber(threadId);
      };
    });
  }

  /**
   * 3) 结果视图:四态(pending / done / need_confirm / error),供 controller 映射 HTTP 语义。
   * 线程不存在同样返回 pending 之外的错误态由调用方处理(这里以 NotFoundException 抛出)。
   */
  readResult(threadId: string): ResultView {
    const rec = this.threadStore.get(threadId);
    if (!rec) throw new NotFoundException('线程不存在');
    if (rec.status === 'error') {
      return { status: 'error', message: rec.error ?? 'AI 执行失败' };
    }
    if (rec.status === 'need_confirm') {
      // 挂起态:下发确认载荷,前端据此渲染「采用当前版本 / 补充约束重跑」
      return { status: 'need_confirm', data: rec.confirmPayload! };
    }
    if (rec.status === 'done' && rec.result) {
      return { status: 'done', data: rec.result };
    }
    return { status: 'pending' }; // running → 202
  }

  /** 3') 兼容旧签名:就绪返回数据,未就绪返回 null,失败抛错 */
  getResult(threadId: string): AiResult | null {
    const view = this.readResult(threadId);
    if (view.status === 'error') throw new Error(view.message);
    if (view.status === 'done') return view.data;
    return null;
  }

  /** 挂起态查询:非挂起返回 undefined(供 controller 判定) */
  getPendingConfirm(threadId: string): HumanConfirmPayload | undefined {
    const rec = this.threadStore.get(threadId);
    if (!rec || rec.status !== 'need_confirm') return undefined;
    return rec.confirmPayload;
  }

  /**
   * 5) 人在回路确认(Task 9.5):
   *   - accept:直接采用候选方案(通常是最后一次格式合法的产出),转为最终结果;
   *   - retry :带着用户补充的约束从挂起快照恢复执行(重新计数,最多再修正 maxRewrites 次)。
   * @returns { status: 'pending', threadId } 供前端继续轮询 result
   */
  async confirmThread(threadId: string, dto: ConfirmDto): Promise<{ status: 'pending'; threadId: string }> {
    const rec = this.threadStore.get(threadId);
    if (!rec) throw new NotFoundException('线程不存在');
    if (rec.status !== 'need_confirm') {
      // 已结束(done/error/running)的线程不可重复确认:保持幂等,直接返回 pending 让前端轮询最新态
      this.logger.warn(`线程 ${threadId} 非挂起态(status=${rec.status}),忽略确认请求`);
      return { status: 'pending', threadId };
    }
    if (rec.resumeToken && dto.resumeToken && dto.resumeToken !== rec.resumeToken) {
      throw new NotFoundException('确认令牌无效或已过期');
    }

    const payload = rec.confirmPayload;
    const suspended = rec.suspendedState ?? {};

    if (dto.choice === 'accept') {
      const result = this.buildAcceptedResult(payload, suspended.intent, dto.candidateId);
      if (!result) {
        // 没有可采用的候选(例如三次都是格式非法):退回 retry 语义,提示补充约束
        throw new NotFoundException('当前没有可采用的候选方案,请补充约束后重新生成');
      }
      this.threadStore.setResult(threadId, result);
      this.toolExecutor.releaseThread(threadId);
      this.thinkStream.end(threadId);
      this.logger.log(`线程 ${threadId} 用户确认采用候选方案`);
      return { status: 'pending', threadId };
    }

    // retry:恢复执行
    if (!this.threadStore.resume(threadId)) {
      throw new NotFoundException('线程状态已变更,无法恢复执行');
    }
    const initial: Partial<AgentState> = {
      threadId,
      sessionId: suspended.sessionId,
      projectId: suspended.projectId,
      query: suspended.query ?? '',
      canvas: suspended.canvas,
      // 恢复后重新计数,给模型完整的修正预算
      rewriteCount: 0,
      maxRewrites: suspended.maxRewrites ?? 2,
      resumeInstruction: dto.instruction?.trim() || undefined,
    };
    this.logger.log(`线程 ${threadId} 用户补充约束后恢复执行: ${dto.instruction ?? '(无补充)'}`);
    void this.executeGraph(threadId, initial);
    return { status: 'pending', threadId };
  }

  /** 把候选方案数据还原成最终 AiResult(按挂起时的意图判定 kind) */
  private buildAcceptedResult(
    payload: HumanConfirmPayload | undefined,
    intent?: string,
    candidateId?: string,
  ): AiResult | undefined {
    const wanted = candidateId ?? 'accept-current';
    const candidate = payload?.candidates?.find((c) => c.id === wanted);
    if (!candidate?.data) return undefined;
    if (intent === 'modify') {
      const operations = candidate.data as Array<Record<string, any>>;
      return { kind: 'modify', operations };
    }
    return { kind: 'generate', flowDraft: candidate.data as any };
  }

  /** 供内部/测试使用:线程记录只读快照 */
  getThread(threadId: string): ThreadRecord | undefined {
    return this.threadStore.get(threadId);
  }
}
