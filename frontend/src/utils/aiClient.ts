// 语图技术方案 - Task 4：统一 AI 接口客户端与 SSE 协议
// 后端契约（serverend/src/ai/ai.controller.ts + src/ai/schemas/chat.schema.ts）：
//   POST /api/ai/chat          -> { threadId }（立即返回，后台跑 LangGraph）
//   SSE  /api/ai/think/:id     -> event: thinking | done | error，data 为 JSON 字符串
//   GET  /api/ai/result/:id    -> 202 { status:'pending' }（带 Retry-After）
//                              -> 200 { status:'need_confirm', data:{ reason, issues[], candidates[] } }
//                              -> 200 { status:'error', message }
//                              -> 200 { status:'done', data: AiResult }
//                              -> 404 线程不存在
//   POST /api/ai/confirm/:id   -> { status:'pending', threadId }
//
// 响应包装：ai 路由四个端点在后端全部标注 @SkipInterceptor，
//          因此正常响应是「裸 JSON」，不会被全局 TransformInterceptor 包成 { code, data, message }；
//          但异常会被 HttpExceptionFilter 输出为 { code:-1, data:{}, message, request }，
//          故本文件统一用 unwrapEnvelope / pickBodyMessage 兼容两种形态。
// 鉴权：与 utils/http.ts 同源，取 localStorage.getItem('Authorization')（原样作为请求头值，不加 Bearer 前缀）。
//      SSE 用原生 EventSource（无法携带自定义请求头），后端把 think 端点设计为公开端点，threadId 即凭证。

// ---------------------------------------------------------------------------
// 类型定义（前端独立声明，与后端 schema 对齐，不 import 后端文件）
// ---------------------------------------------------------------------------

// model-routing-batch:模型偏好类型从本地工具模块引入(前端内单一来源,选项/净化/存储同源)
import type { ModelPreference } from './modelPreference';

export type IntentType = 'generate' | 'modify' | 'consult';

export type CanvasNodeType =
  | 'start'
  | 'end'
  | 'process'
  | 'decision'
  | 'io'
  | 'subprocess';

/** 画布语义摘要节点（modify 场景需要） */
export interface CanvasNodeSummary {
  id: string;
  label: string;
  type: CanvasNodeType;
}

export interface ChatRequest {
  message: string;
  canvas?: CanvasNodeSummary[];
  sessionId?: string;
  projectId?: string;
  /** 匿名试用身份（免登录试用链路）：携带时改走 POST /ai/trial/chat（Task 3 增长方案） */
  trialId?: string;
  /**
   * 产物形态提示（multi-artifact-batch）：用户显式指定产物形态（浮窗快捷 chips 使用），
   * 后端 FormRouter 最高优先级直通；白名单外值由后端 zod 校验拒绝（400）。
   */
  formHint?: ArtifactKind;
  /**
   * 模型偏好（model-routing-batch）：手选档位直通（flagship 需会员）；
   * auto/缺省由后端复杂度路由决定。试用链路不携带（后端强制轻量档控成本）。
   */
  modelPreference?: ModelPreference;
}

export interface ChatResponse {
  threadId: string;
  intent?: IntentType;
}

/** 思考流事件（与后端 ThinkSseEvent 一致） */
export type ThinkSseEvent =
  | { type: 'thinking'; data: { token: string } }
  | { type: 'done'; data: { threadId: string } }
  | { type: 'error'; data: { message: string } };

export interface FlowDraftNode {
  id: string;
  label: string;
  type: string;
}

export interface FlowDraftEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowDraft {
  nodes: FlowDraftNode[];
  edges: FlowDraftEdge[];
}

// ---------------------------------------------------------------------------
// 多形态产物契约（multi-artifact-batch）：与后端 schemas/artifact.schema.ts 对齐（不 import 后端文件）
// ---------------------------------------------------------------------------

/** 产物形态：flowchart 为缺省值（向后兼容——旧响应无 artifactKind 时按 flowchart 消费） */
export type ArtifactKind = 'flowchart' | 'mindmap' | 'table' | 'checklist' | 'timeline';

/** 思维导图节点（递归树；id 全树唯一，前端转 X6 时作节点主键） */
export interface MindMapNode {
  id: string;
  label: string;
  children: MindMapNode[];
}

export interface MindMapDraft {
  root: MindMapNode;
}

/** 对比表格：列为维度、行为对象；conclusion 为可选推荐结论 */
export interface TableDraft {
  columns: string[];
  rows: string[][];
  conclusion?: string;
}

/** 清单：分组 + 可勾选项；owner/due 为自由文本（材料里提到才填） */
export interface ChecklistItem {
  text: string;
  owner?: string;
  due?: string;
}

export interface ChecklistGroup {
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistDraft {
  groups: ChecklistGroup[];
}

/** 时间线：数组顺序即时间顺序；time 为自由文本标记（Day1 / 09:00 / 第 3 周） */
export interface TimelineEvent {
  time: string;
  title: string;
  detail?: string;
}

export interface TimelineDraft {
  events: TimelineEvent[];
}

/**
 * generate 结果：按 artifactKind 携带对应 payload。
 * 兼容性：artifactKind 缺省 = flowchart（旧响应只有 flowDraft，行为零变化）；
 * 消费侧（浮窗/artifacts 层）须以 artifactKind ?? 'flowchart' 分发。
 */
export interface GenerateResult {
  kind: 'generate';
  artifactKind?: ArtifactKind;
  flowDraft?: FlowDraft;
  mindmapDraft?: MindMapDraft;
  tableDraft?: TableDraft;
  checklistDraft?: ChecklistDraft;
  timelineDraft?: TimelineDraft;
}

export interface ModifyResult {
  kind: 'modify';
  operations: Array<Record<string, any>>;
}

export interface ConsultResult {
  kind: 'consult';
  answer: string;
}

export type AiResult = GenerateResult | ModifyResult | ConsultResult;

/** 人在回路：未解决的 error 级问题 */
export interface ConfirmIssue {
  layer: string;
  type?: string;
  message: string;
  nodeIds?: string[];
}

/** 人在回路：候选修正方案 */
export interface ConfirmCandidate {
  id: string;
  label: string;
  /** generate 场景是 FlowDraft，modify 场景是 operations */
  data?: unknown;
  note?: string;
}

export interface HumanConfirmPayload {
  reason: string;
  issues: ConfirmIssue[];
  candidates: ConfirmCandidate[];
}

/** result 端点四态 */
export type AiResultResponse =
  | { status: 'pending' }
  | { status: 'need_confirm'; data: HumanConfirmPayload }
  | { status: 'error'; message: string }
  | { status: 'done'; data: AiResult };

export type ConfirmChoice = 'accept' | 'retry';

/** 确认请求体：注意补充约束字段名是 instruction（后端 ConfirmRequestSchema），不是 message */
export interface ConfirmRequest {
  choice: ConfirmChoice;
  /** retry 时的补充约束（一句话，≤500 字） */
  instruction?: string;
  /** 指定候选方案 id（≤64） */
  candidateId?: string;
  /** 挂起时下发的恢复令牌（≤128），用于防重复提交 */
  resumeToken?: string;
}

export interface ConfirmResponse {
  status: 'pending';
  threadId: string;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 与 vite dev proxy / 生产同源部署一致：始终用相对路径，不硬编码域名 */
export const AI_API_BASE = '/api';

export const DEFAULT_POLL_TIMEOUT_MS = 120000;
/** 轮询退避：1s → 2s → 3s（封顶） */
export const POLL_BASE_DELAY_MS = 1000;
export const POLL_MAX_DELAY_MS = 3000;
/** Retry-After 生效时的上下限，避免 0 造成忙轮询、过大造成无响应 */
export const POLL_MIN_DELAY_MS = 250;
export const RETRY_AFTER_MAX_MS = 10000;
/** 思考流 done 事件丢失时的兜底起轮延迟（线程执行过快、订阅前已收尾的竞态） */
export const STREAM_WATCHDOG_MS = 2000;
/** 错误响应体摘要长度上限 */
export const ERROR_BODY_SUMMARY_LIMIT = 200;

const MESSAGE_MAX_LEN = 2000;
const INSTRUCTION_MAX_LEN = 500;
const CANDIDATE_ID_MAX_LEN = 64;
const RESUME_TOKEN_MAX_LEN = 128;

// ---------------------------------------------------------------------------
// URL 构造（纯函数，便于断言）
// ---------------------------------------------------------------------------

export function chatUrl(): string {
  return `${AI_API_BASE}/ai/chat`;
}

/** 免登录单次试用链路（Task 3 增长方案）：@Public 端点，trialId 即匿名身份；SSE / result / confirm 三条后续链路与登录态共用 */
export function trialChatUrl(): string {
  return `${AI_API_BASE}/ai/trial/chat`;
}

export function thinkStreamUrl(threadId: string): string {
  return `${AI_API_BASE}/ai/think/${encodeURIComponent(threadId)}`;
}

export function resultUrl(threadId: string): string {
  return `${AI_API_BASE}/ai/result/${encodeURIComponent(threadId)}`;
}

export function confirmUrl(threadId: string): string {
  return `${AI_API_BASE}/ai/confirm/${encodeURIComponent(threadId)}`;
}

// ---------------------------------------------------------------------------
// 错误类型：HttpError（utils/http.ts 的 catch 块共用）
// ---------------------------------------------------------------------------

/**
 * 统一的 HTTP 错误：保留可读 message、状态码与响应体摘要。
 * 取代 `JSON.stringify(axiosError)`（对 axios 错误恒为 "{}"）的旧实现。
 */
export class HttpError extends Error {
  readonly status?: number;
  readonly data?: unknown;
  readonly bodySummary?: string;

  constructor(message: string, status?: number, data?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
    this.bodySummary = summarizeErrorBody(data);
  }
}

/** 主动取消（abort）时抛出，调用方据此静默收尾，不提示用户 */
export class AbortError extends Error {
  constructor(message = '请求已取消') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof AbortError) return true;
  const candidate = err as { name?: string } | null;
  return candidate?.name === 'AbortError';
}

/** 响应体摘要：截断长文本，序列化失败退化为 String() */
export function summarizeErrorBody(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  let text: string;
  if (typeof data === 'string') {
    text = data;
  } else {
    try {
      text = JSON.stringify(data) ?? String(data);
    } catch {
      text = String(data);
    }
  }
  if (!text) return undefined;
  return text.length > ERROR_BODY_SUMMARY_LIMIT
    ? `${text.slice(0, ERROR_BODY_SUMMARY_LIMIT)}...(截断)`
    : text;
}

/** 从后端错误体中取可读消息（HttpExceptionFilter: { code:-1, data:{}, message }） */
export function pickBodyMessage(data: unknown): string {
  if (typeof data === 'string') return data.trim();
  if (!data || typeof data !== 'object') return '';
  const message = (data as { message?: unknown }).message;
  if (typeof message === 'string') return message.trim();
  // ValidationPipe 的 message 可能是字符串数组
  if (Array.isArray(message) && message.length > 0) {
    const first = message[0];
    if (typeof first === 'string') return first.trim();
  }
  return '';
}

/**
 * 把任意异常（axios 错误 / fetch 错误 / 字符串）转成 HttpError。
 * 提取 message、status(err.response?.status)、响应体摘要(err.response?.data)。
 */
export function toHttpError(err: unknown, fallbackMessage = '网络请求失败'): HttpError {
  if (err instanceof HttpError) return err;
  const source = err as {
    message?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: unknown };
    data?: unknown;
  } | null;

  const rawStatus = source?.response?.status ?? source?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const data = source?.response?.data ?? source?.data;

  const fromString = typeof err === 'string' ? err.trim() : '';
  const fromError = typeof source?.message === 'string' ? source.message.trim() : '';
  const base = pickBodyMessage(data) || fromString || fromError || fallbackMessage;

  return new HttpError(status ? `${base}（HTTP ${status}）` : base, status, data);
}

/** 由 HTTP 响应构造错误（非 2xx / 404 场景） */
function errorFromResponse(status: number, body: unknown, fallback: string): HttpError {
  const base = pickBodyMessage(body) || fallback;
  return new HttpError(`${base}（HTTP ${status}）`, status, body);
}

/**
 * 从错误对象中提取响应体的字符串业务 code（如试用链路的 TRIAL_USED / TRIAL_BUSY / TRIAL_RATE_LIMITED）。
 * 兼容 HttpError（.data 即响应体）与 axios 错误（.response.data）两种形态。
 * 注意：后端全局异常过滤器会把错误体 code 重写为数字 -1，字符串 code 仅在
 * 部分直抛路径中存在；调用方识别试用拦截时应结合状态码与文案片段兜底（见 ai_float_window）。
 */
export function pickErrorCode(err: unknown): string | undefined {
  if (!err) return undefined;
  const source = err as { data?: unknown; response?: { data?: unknown } } | null;
  const body = source?.response?.data ?? source?.data;
  if (!body || typeof body !== 'object') return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

// ---------------------------------------------------------------------------
// 鉴权与底层请求
// ---------------------------------------------------------------------------

/** 与 utils/http.ts 同源：localStorage 的 Authorization 原样作为请求头值 */
export function readAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('Authorization');
  } catch {
    return null;
  }
}

export function authHeaders(): Record<string, string> {
  const token = readAuthToken();
  return token ? { Authorization: token } : {};
}

interface RawResponse {
  status: number;
  body: unknown;
  retryAfter: string | null;
}

async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...authHeaders(),
  };
  const init: RequestInit = { method, headers, signal };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) throw new AbortError();
    throw toHttpError(err, '无法连接 AI 服务');
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, retryAfter: response.headers.get('Retry-After') };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new AbortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// 纯逻辑：响应归一化 / SSE 帧解析 / 退避序列
// ---------------------------------------------------------------------------

/**
 * 剥掉 { code, data, message } 外壳（全局 TransformInterceptor 形态）。
 * ai 路由已 @SkipInterceptor，正常不会命中；错误响应与未来变更时用于兜底。
 */
export function unwrapEnvelope<T = unknown>(body: unknown): T | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if ('code' in record && 'data' in record && record.data && typeof record.data === 'object') {
    return record.data as T;
  }
  return body as T;
}

/** result 端点响应体 → 四态；无法识别返回 null */
export function normalizeResultPayload(body: unknown): AiResultResponse | null {
  const payload = unwrapEnvelope<Record<string, unknown>>(body);
  if (!payload) return null;

  const status = payload.status;
  // 202 的 body 是 { status:'pending' }；'processing' 为兼容别名
  if (status === 'pending' || status === 'processing') return { status: 'pending' };

  if (status === 'done') {
    return { status: 'done', data: (payload.data ?? {}) as AiResult };
  }

  if (status === 'need_confirm') {
    const raw = (payload.data ?? {}) as Partial<HumanConfirmPayload>;
    return {
      status: 'need_confirm',
      data: {
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        issues: Array.isArray(raw.issues) ? raw.issues : [],
        candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
      },
    };
  }

  if (status === 'error') {
    return { status: 'error', message: pickBodyMessage(payload) || 'AI 执行失败' };
  }

  return null;
}

/** confirm 端点响应体 → { status:'pending', threadId } */
export function normalizeConfirmPayload(body: unknown, fallbackThreadId = ''): ConfirmResponse | null {
  const payload = unwrapEnvelope<Record<string, unknown>>(body);
  if (!payload) return null;
  return {
    status: 'pending',
    threadId: typeof payload.threadId === 'string' ? payload.threadId : fallbackThreadId,
  };
}

/**
 * 解析一帧思考流。
 * @param eventName SSE 的 event 名（后端用 type 作为事件名）；缺省时从 data 内的 type 字段推断
 * @param rawData   SSE 的 data 原文（JSON 字符串）
 */
export function parseThinkSseEvent(
  eventName: string | null | undefined,
  rawData: unknown,
): ThinkSseEvent | null {
  const text = typeof rawData === 'string' ? rawData.trim() : '';
  if (!text) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  // data 可能是「事件整体」({ type, data }) 或「仅 data 部分」({ token } / { threadId } / { message })
  const inner =
    record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : record;
  const name = (eventName ?? '').trim() || (typeof record.type === 'string' ? record.type : '');

  switch (name) {
    case 'thinking':
      return { type: 'thinking', data: { token: typeof inner.token === 'string' ? inner.token : '' } };
    case 'done':
      return { type: 'done', data: { threadId: typeof inner.threadId === 'string' ? inner.threadId : '' } };
    case 'error':
      return {
        type: 'error',
        data: { message: (typeof inner.message === 'string' && inner.message) || 'AI 执行失败' },
      };
    default:
      return null;
  }
}

/** Retry-After 头 → 秒（支持秒数与 HTTP-date）；无法解析返回 null */
export function parseRetryAfterSeconds(header: string | null | undefined): number | null {
  const raw = (header ?? '').trim();
  if (!raw) return null;

  // 纯数字（可带符号 / 小数）一律按「秒」解析：负数非法直接返回 null，
  // 否则会落到 Date.parse 把 "-1" 误当成年份。
  if (/^[+-]?\d*\.?\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) return Math.max(0, (timestamp - Date.now()) / 1000);
  return null;
}

/**
 * 下一次轮询等待毫秒数：
 *   - 有 Retry-After：按其值（clamp 到 [POLL_MIN_DELAY_MS, RETRY_AFTER_MAX_MS]）
 *   - 否则线性退避 1s → 2s → 3s（封顶）
 * @param attempt 已完成的轮询次数（从 1 开始）
 */
export function nextPollDelayMs(attempt: number, retryAfter?: string | null): number {
  const seconds = parseRetryAfterSeconds(retryAfter);
  if (seconds !== null) {
    const ms = Math.round(seconds * 1000);
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(POLL_MIN_DELAY_MS, ms));
  }
  const nth = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return Math.min(POLL_MAX_DELAY_MS, POLL_BASE_DELAY_MS * nth);
}

// ---------------------------------------------------------------------------
// 1) POST /ai/chat
// ---------------------------------------------------------------------------

export async function startChat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const message = typeof req?.message === 'string' ? req.message.trim() : '';
  if (!message) throw new HttpError('消息不能为空', 400);
  if (message.length > MESSAGE_MAX_LEN) {
    throw new HttpError(`消息过长（最多 ${MESSAGE_MAX_LEN} 字）`, 400);
  }

  const payload: ChatRequest = { message };
  if (Array.isArray(req.canvas)) payload.canvas = req.canvas;
  if (req.sessionId) payload.sessionId = req.sessionId;
  if (req.projectId) payload.projectId = req.projectId;
  if (req.trialId) payload.trialId = req.trialId;
  // model-routing-batch:模型偏好仅在登录链路携带(试用端点不收该字段,后端强制轻量档);
  // auto 为后端默认值,不传以保持请求体精简
  if (!req.trialId && req.modelPreference && req.modelPreference !== 'auto') {
    payload.modelPreference = req.modelPreference;
  }

  // 试用链路：携带 trialId 时改走 /ai/trial/chat（匿名单次试用）；
  // 该端点响应经 TransformInterceptor 包成 { code:0, data:{ threadId }, message }，
  // 与 /ai/chat 的裸 { threadId } 不同 —— 由下方 unwrapEnvelope 统一兼容（包装 → 剥壳取 data）。
  const res = await requestJson('POST', req.trialId ? trialChatUrl() : chatUrl(), payload, signal);
  if (res.status < 200 || res.status >= 300) {
    throw errorFromResponse(res.status, res.body, '创建 AI 会话失败');
  }

  const data = unwrapEnvelope<Record<string, unknown>>(res.body);
  const threadId = data && typeof data.threadId === 'string' ? data.threadId : '';
  if (!threadId) throw new HttpError('AI 服务未返回 threadId', res.status, res.body);

  const intent = data?.intent;
  const response: ChatResponse = { threadId };
  if (typeof intent === 'string') response.intent = intent as IntentType;
  return response;
}

// ---------------------------------------------------------------------------
// 2) SSE /ai/think/:threadId
// ---------------------------------------------------------------------------

export interface ThinkHandlers {
  onThinking?: (token: string) => void;
  onDone?: (threadId: string) => void;
  onError?: (message: string) => void;
}

export interface ThinkConnection {
  /** 幂等：关闭 EventSource 并摘除所有监听器 */
  close(): void;
}

/**
 * 订阅思考流。收到 done / error 终态后自动 close（否则服务端 complete 会触发浏览器重连）；
 * 原生连接错误（无 data 的 error 事件）同样 close 并回调 onError。
 */
export function connectThink(threadId: string, handlers: ThinkHandlers = {}): ThinkConnection {
  let closed = false;
  const source = new EventSource(thinkStreamUrl(threadId));

  const onThinkingFrame = (event: Event): void => {
    if (closed) return;
    const parsed = parseThinkSseEvent('thinking', (event as MessageEvent).data);
    if (parsed?.type === 'thinking') handlers.onThinking?.(parsed.data.token);
  };

  const onDoneFrame = (event: Event): void => {
    if (closed) return;
    const parsed = parseThinkSseEvent('done', (event as MessageEvent).data);
    close();
    handlers.onDone?.(parsed?.type === 'done' && parsed.data.threadId ? parsed.data.threadId : threadId);
  };

  const onErrorFrame = (event: Event): void => {
    if (closed) return;
    // 服务端 `event: error` 帧带 data；纯连接层错误没有 data
    const parsed = parseThinkSseEvent('error', (event as MessageEvent).data);
    close();
    handlers.onError?.(parsed?.type === 'error' ? parsed.data.message : '思考流连接中断');
  };

  // 兜底：服务端未带 event 名（裸 message 帧）时按 data 内的 type 分派
  const onRawFrame = (event: Event): void => {
    if (closed) return;
    const parsed = parseThinkSseEvent(null, (event as MessageEvent).data);
    if (!parsed) return;
    if (parsed.type === 'thinking') handlers.onThinking?.(parsed.data.token);
    else if (parsed.type === 'done') onDoneFrame(event);
    else onErrorFrame(event);
  };

  function close(): void {
    if (closed) return;
    closed = true;
    source.removeEventListener('thinking', onThinkingFrame);
    source.removeEventListener('done', onDoneFrame);
    source.removeEventListener('error', onErrorFrame);
    source.removeEventListener('message', onRawFrame);
    source.close();
  }

  source.addEventListener('thinking', onThinkingFrame);
  source.addEventListener('done', onDoneFrame);
  source.addEventListener('error', onErrorFrame);
  source.addEventListener('message', onRawFrame);

  return { close };
}

// ---------------------------------------------------------------------------
// 3) GET /ai/result/:threadId（202 轮询）
// ---------------------------------------------------------------------------

export interface PollOptions {
  /** 总超时（毫秒），默认 120000 */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * 轮询结果：202 时按 Retry-After（缺省 1s→2s→3s 封顶）退避重试，
 * 直到拿到 done / need_confirm / error；总超时与 404 抛可读的 HttpError。
 */
export async function pollResult(
  threadId: string,
  options: PollOptions = {},
): Promise<AiResultResponse> {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_POLL_TIMEOUT_MS;
  const signal = options.signal;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  for (;;) {
    if (signal?.aborted) throw new AbortError();

    const res = await requestJson('GET', resultUrl(threadId), undefined, signal);

    if (res.status === 404) {
      throw errorFromResponse(404, res.body, 'AI 线程不存在或已过期');
    }

    if (res.status !== 202) {
      if (res.status < 200 || res.status >= 300) {
        throw errorFromResponse(res.status, res.body, '获取 AI 结果失败');
      }
      const normalized = normalizeResultPayload(res.body);
      if (!normalized) {
        throw new HttpError('AI 结果响应格式无法识别', res.status, res.body);
      }
      return normalized;
    }

    attempt += 1;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(timeoutMs);
    await sleep(Math.min(nextPollDelayMs(attempt, res.retryAfter), remaining), signal);
    if (Date.now() >= deadline) throw timeoutError(timeoutMs);
  }
}

function timeoutError(timeoutMs: number): HttpError {
  return new HttpError(
    `AI 生成超时（已等待 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试`,
    408,
  );
}

// ---------------------------------------------------------------------------
// 4) POST /ai/confirm/:threadId
// ---------------------------------------------------------------------------

export async function confirmChoice(
  threadId: string,
  body: ConfirmRequest,
  signal?: AbortSignal,
): Promise<ConfirmResponse> {
  const choice = body?.choice;
  if (choice !== 'accept' && choice !== 'retry') {
    throw new HttpError('choice 只能是 accept 或 retry', 400);
  }

  const payload: ConfirmRequest = { choice };

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction) {
    if (instruction.length > INSTRUCTION_MAX_LEN) {
      throw new HttpError(`补充约束过长（最多 ${INSTRUCTION_MAX_LEN} 字）`, 400);
    }
    payload.instruction = instruction;
  }
  if (body.candidateId) {
    if (body.candidateId.length > CANDIDATE_ID_MAX_LEN) {
      throw new HttpError(`候选方案 id 过长（最多 ${CANDIDATE_ID_MAX_LEN} 字）`, 400);
    }
    payload.candidateId = body.candidateId;
  }
  if (body.resumeToken) {
    if (body.resumeToken.length > RESUME_TOKEN_MAX_LEN) {
      throw new HttpError(`恢复令牌过长（最多 ${RESUME_TOKEN_MAX_LEN} 字）`, 400);
    }
    payload.resumeToken = body.resumeToken;
  }

  const res = await requestJson('POST', confirmUrl(threadId), payload, signal);
  if (res.status === 404) {
    throw errorFromResponse(404, res.body, 'AI 线程不存在或确认已过期');
  }
  if (res.status < 200 || res.status >= 300) {
    throw errorFromResponse(res.status, res.body, '提交确认失败');
  }
  return normalizeConfirmPayload(res.body, threadId) ?? { status: 'pending', threadId };
}

// ---------------------------------------------------------------------------
// 5) 组合：startChat → connectThink → pollResult →（need_confirm）→ 最终结果
// ---------------------------------------------------------------------------

export interface ConfirmActions {
  threadId: string;
  /** 提交用户裁决（accept / retry），成功后内部自动继续轮询直至最终结果；已 abort 时为 no-op */
  confirm(body: ConfirmRequest): Promise<void>;
}

export interface AiSessionHandlers {
  /** 拿到 threadId（可用于展示 / 取消） */
  onThreadId?: (threadId: string) => void;
  /** 思考流 token 增量 */
  onThinking?: (token: string) => void;
  /** 思考流正常收尾（done），随后开始拉结果 */
  onStreamDone?: (threadId: string) => void;
  /** 人在回路挂起：由调用方渲染确认 UI，再调 actions.confirm(...) */
  onNeedConfirm?: (payload: HumanConfirmPayload, actions: ConfirmActions) => void;
  /** 最终结果（done） */
  onResult?: (result: AiResult, threadId: string) => void;
  /** 任一路径失败（含超时 / 404 / 流错误后结果仍不可用） */
  onError?: (message: string, error?: unknown) => void;
}

export interface AiSessionOptions {
  /** 结果轮询总超时，默认 DEFAULT_POLL_TIMEOUT_MS */
  pollTimeoutMs?: number;
  /** 思考流 done 丢失时的兜底起轮延迟，默认 STREAM_WATCHDOG_MS */
  streamWatchdogMs?: number;
}

export interface AiSession {
  /** 关闭 EventSource、清所有定时器、中断进行中的请求；幂等 */
  abort(): void;
}

/**
 * 一次完整 AI 会话。同步返回句柄，内部异步推进：
 *   startChat → connectThink（token 流）→ done/watchdog → pollResult
 *   → need_confirm 时回调 onNeedConfirm（调用方 confirm 后自动继续 pollResult）
 *   → 最终 onResult / onError。
 * 三条清理路径（超时 / error 事件 / abort）都会关闭连接并清空定时器。
 */
export function runAiSession(
  req: ChatRequest,
  handlers: AiSessionHandlers = {},
  options: AiSessionOptions = {},
): AiSession {
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  let think: ThinkConnection | null = null;
  let polling: Promise<void> | null = null;
  let threadId = '';
  let aborted = false;
  let finished = false;

  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (aborted || finished) return;
      fn();
    }, ms);
    timers.add(timer);
  };

  const cleanup = (): void => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    if (think) {
      think.close();
      think = null;
    }
  };

  const fail = (message: string, error?: unknown): void => {
    if (aborted || finished) return;
    finished = true;
    cleanup();
    handlers.onError?.(message, error);
  };

  const succeed = (result: AiResult): void => {
    if (aborted || finished) return;
    finished = true;
    cleanup();
    handlers.onResult?.(result, threadId);
  };

  const closeThink = (): void => {
    if (think) {
      think.close();
      think = null;
    }
  };

  const startPolling = (): Promise<void> => {
    if (polling) return polling;
    if (aborted || finished || !threadId) return Promise.resolve();

    polling = pollResult(threadId, {
      timeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      signal: controller.signal,
    })
      .then((res) => handleResult(res))
      .catch((err: unknown) => {
        polling = null;
        if (aborted || isAbortError(err)) return;
        fail(toHttpError(err, '获取 AI 结果失败').message, err);
      });
    return polling;
  };

  const handleResult = async (res: AiResultResponse): Promise<void> => {
    if (aborted || finished) return;

    if (res.status === 'done') {
      succeed(res.data);
      return;
    }

    if (res.status === 'error') {
      fail(res.message || 'AI 执行失败');
      return;
    }

    if (res.status === 'need_confirm') {
      // 思考流已无用：释放连接与定时器，但保留 abort 能力（用户可能长时间停留）
      closeThink();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      polling = null;

      if (!handlers.onNeedConfirm) {
        fail(`AI 需要人工确认：${res.data.reason || '请确认后继续'}`, res.data);
        return;
      }

      const confirm = async (body: ConfirmRequest): Promise<void> => {
        if (aborted || finished) return;
        try {
          await confirmChoice(threadId, body, controller.signal);
        } catch (err) {
          if (aborted || isAbortError(err)) return;
          fail(toHttpError(err, '提交确认失败').message, err);
          return;
        }
        if (aborted || finished) return;
        await startPolling();
      };

      handlers.onNeedConfirm(res.data, { threadId, confirm });
      return;
    }

    // pending：pollResult 不会以 pending 收尾（内部持续轮询到超时），此处防御性报错
    fail('AI 结果未就绪，请稍后重试');
  };

  void (async (): Promise<void> => {
    try {
      const chat = await startChat(req, controller.signal);
      if (aborted) return;
      threadId = chat.threadId;
      handlers.onThreadId?.(threadId);

      think = connectThink(threadId, {
        onThinking: (token) => {
          if (aborted || finished) return;
          handlers.onThinking?.(token);
        },
        onDone: (id) => {
          if (aborted || finished) return;
          closeThink();
          handlers.onStreamDone?.(id || threadId);
          void startPolling();
        },
        onError: () => {
          // 思考流断开不等于结果不可用（例如代理掐断长连接）：关闭连接后交给结果轮询兜底，
          // 真正失败时由 pollResult 的 404 / 超时 / error 态走 onError。
          if (aborted || finished) return;
          closeThink();
          void startPolling();
        },
      });

      // 兜底：线程执行过快时 done 可能在订阅前就已推送（后端通道已清理），watchdog 到点直接起轮
      later(() => {
        void startPolling();
      }, options.streamWatchdogMs ?? STREAM_WATCHDOG_MS);
    } catch (err) {
      if (aborted || isAbortError(err)) return;
      fail(toHttpError(err, 'AI 请求失败').message, err);
    }
  })();

  return {
    abort(): void {
      if (aborted) return;
      aborted = true;
      controller.abort();
      cleanup();
    },
  };
}
