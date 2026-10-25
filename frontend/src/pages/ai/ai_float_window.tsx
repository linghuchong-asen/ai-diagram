// 语图技术方案 - Task 5：AI 浮窗挂载与人在回路 UI（Neon Dark 科技感版本）
// 数据链路（全部经 utils/aiClient.runAiSession，浮窗内不再自建 chat / EventSource / 轮询）：
//   发送：message + canvas（graph.toJSON() → x6ToFlowDraft → CanvasNodeSummary[]，空画布省略）
//         + sessionId（首个 thread 后固定）+ projectId（x6Editor 路由参数）
//   onThinking 思考 token 流式展示 → onNeedConfirm 渲染确认卡片（ConfirmActions.confirm 提交裁决）
//   → onResult 分派：
//     generate：autoLayout → flowDraftToX6(origin 'ai-generate') → 浮窗内只读 X6 预览，
//               点「应用到画布」后写入主图（画布非空时保留既有节点并整体右移避让）；
//     modify：snapshotFromGraphJSON → buildApplyPlan → 有歧义或多项时弹 ModifyPlanModal
//             （承载 ApplyPlanPanel），确认后 applyOperations → 残差显式展示（归因）→
//             report.snapshot 拼回 X6（origin 'ai-modify'）→ graph.fromJSON；
//             单项且无歧义时直接应用（ApplyPlanPanel 面板仅歧义/多项时弹出）；
//     consult：answer 直接展示。
//   生命周期：卸载/收起时 session.abort()；发送中禁用重复提交；onError 展示可读信息 + 重试。
// 注意：confirm 请求体的补充约束字段名是 instruction（非 message），resumeToken 随 payload 透传。
// UI 设计语言：Neon Dark（近黑深蓝玻璃 + 电光青强调 + 等宽技术标签 + 思考流打字光标），
//   快捷提示词 chips 源自竞品调研（Eraser presets / Napkin 无门槛生成），点击即发送。

import { useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import { Alert, Button, Input, Space, Spin, notification } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  HttpError,
  pickErrorCode,
  runAiSession,
  type AiResult,
  type AiSession,
  type CanvasNodeSummary,
  type ChatRequest,
  type ConfirmActions,
  type ConfirmChoice,
  type ConfirmRequest,
  type FlowDraft as AiFlowDraft,
  type HumanConfirmPayload,
} from '../../utils/aiClient';
import { http } from '../../utils/http';
import { useIsMobile } from '../../utils/hooks/useIsMobile';
import { getTrialId, saveTrialDraft } from '../../utils/trialIdentity';
import { autoLayout } from './layout/auto-layout';
import { flowDraftToX6, x6ToFlowDraft, type FlowDraftLike, type FlowDraftToX6Result } from './transform/to-x6';
import type { PatchOperation, X6GraphJSON } from './transform/types';
import { snapshotFromGraphJSON, type CanvasSnapshot } from './match/match-level';
import { applyOperations, buildApplyPlan, type ApplyPlan, type ApplyReport } from './match/apply-operations';
import HumanConfirmCard from './confirm-card/human-confirm-card';
import X6FlowPreview from './preview/x6-preview-canvas';
import ModifyPlanModal from './modify/modify-plan-modal';
import {
  extractResumeToken,
  mergeGeneratedIntoCanvas,
  restoreSnapshotToX6Data,
  summarizeApplyReport,
  summarizeGeneratePreview,
  toCanvasSummaries,
} from './session/ai-flow-logic';

export interface AiFloatWindowProps {
  /** 主画布实例（x6Editor 的 useGraph 产物，就绪前为 undefined） */
  graph?: Graph;
  /** 项目 id（/editor/:projectid/:projectName 路由参数） */
  projectId?: string;
  /** 试用模式（免登录单次试用）：不拉配额、请求附 trialId 走 /ai/trial/chat、429 拦截转注册引导 */
  trialMode?: boolean;
  /** 初始提示词（/trial?q= 落地）：画布就绪后自动发送一次 */
  initialPrompt?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 注册引导卡（试用链路 429 拦截 / 应用成功后的转化钩子）：气泡内附带「注册继续生成」按钮 */
  registerGuide?: boolean;
}

/** /ai/quota 返回的每日用量视图（与后端 DailyUsageView 字段对齐） */
interface DailyUsageView {
  day: string;
  generateCount: number;
  modifyCount: number;
  tokens: number;
  generateLimit: number;
  modifyLimit: number;
  tokenLimit: number;
}

/** idle 空闲 / running 思考与轮询 / confirm 待人工裁决 / waiting 已确认等待结果 */
type Phase = 'idle' | 'running' | 'confirm' | 'waiting';

interface ConfirmState {
  payload: HumanConfirmPayload;
  actions: ConfirmActions;
}

interface GeneratePreviewState {
  /** flowDraftToX6 输出（含 droppedEdges / degradedNodeIds 明细） */
  data: FlowDraftToX6Result;
  /** 应用时画布是否已有节点（决定「避让」还是「整体替换」） */
  hasExistingNodes: boolean;
}

interface ModifyState {
  plan: ApplyPlan;
  operations: PatchOperation[];
  snapshot: CanvasSnapshot;
  selectedIndexes: number[];
  resolvedAmbiguous: Record<number, string>;
  report: ApplyReport | null;
  applying: boolean;
}

/** 快捷提示词（空状态引导）：点击即发送，降低首次使用门槛 */
const PRESET_PROMPTS: Array<{ label: string; text: string }> = [
  {
    label: '请假审批流程',
    text: '帮我生成一个员工请假审批流程图：员工提交请假申请，直属主管审批，超过 3 天需要部门总监复核，通过后人事备案，驳回则修改后重新提交。',
  },
  {
    label: '电商订单流程',
    text: '帮我生成一个电商订单处理流程图：用户下单、支付、库存校验、风控审核、发货、物流签收，支持退款分支。',
  },
  {
    label: '用户注册登录',
    text: '帮我生成一个用户注册登录流程图：手机号注册、验证码校验、设置密码、登录，含找回密码分支。',
  },
  {
    label: '系统部署上线',
    text: '帮我生成一个应用系统部署上线流程图：代码构建、自动化测试、安全扫描、灰度发布、全量上线，含回滚分支。',
  },
];

/** graph.toJSON() 返回 X6 运行时 Cell.Properties，结构与转换层的宽松 X6GraphJSON 兼容 */
function canvasJSON(graph: Graph | undefined): X6GraphJSON | undefined {
  if (!graph) return undefined;
  return graph.toJSON() as unknown as X6GraphJSON;
}

/** 试用 429 拦截的已知文案片段（后端全局异常过滤器会把响应体 code 重写为 -1，字符串 code 无法透出，按文案兜底识别） */
const TRIAL_BLOCK_MESSAGE_FRAGMENTS = ['试用次数已用完', '今日试用名额已满', '操作过于频繁'];

/**
 * 判定是否为试用链路的 429 拦截（TRIAL_USED / TRIAL_BUSY / TRIAL_RATE_LIMITED）：
 * 优先读响应体字符串 code（pickErrorCode，未来过滤器修复后直连），
 * 现行兜底按「HTTP 429 + 已知文案片段」识别。
 */
function isTrialBlockError(trialMode: boolean, message: string, error: unknown): boolean {
  if (!trialMode) return false;
  const code = pickErrorCode(error);
  if (code === 'TRIAL_USED' || code === 'TRIAL_BUSY' || code === 'TRIAL_RATE_LIMITED') return true;
  const status = error instanceof HttpError ? error.status : undefined;
  return status === 429 && TRIAL_BLOCK_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/** X6 纯数据 → Graph.fromJSON 入参（attrs/ports 声明不兼容但运行时一致，统一在此断言） */
function toGraphFromJSONData(data: unknown): Parameters<Graph['fromJSON']>[0] {
  return data as Parameters<Graph['fromJSON']>[0];
}

export default function AiFloatWindow({ graph, projectId, trialMode = false, initialPrompt }: AiFloatWindowProps) {
  // 移动端轻客户端策略：窄屏下浮窗切换为全屏对话（移动端主场景即「对话生成」）
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [thinking, setThinking] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewState | null>(null);
  const [modify, setModify] = useState<ModifyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaText, setQuotaText] = useState('');

  const sessionRef = useRef<AiSession | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const lastMessageRef = useRef<string | undefined>(undefined);

  const busy = phase !== 'idle';

  useEffect(() => {
    // 卸载时终止进行中的会话（关闭 SSE / 清定时器 / 中断轮询）
    return () => {
      sessionRef.current?.abort();
      sessionRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 当日配额展示（旁路能力：失败静默，不影响 AI 会话主链路）
  // ---------------------------------------------------------------------------

  /** 拉取 /ai/quota 并刷新配额文案 */
  const fetchQuota = () => {
    http<DailyUsageView>('/ai/quota')
      .then((response) => {
        const { code, data } = response;
        if (code !== 0 || !data) return;
        setQuotaText(
          `今日额度 生成 ${data.generateCount}/${data.generateLimit} · 修改 ${data.modifyCount}/${data.modifyLimit}`,
        );
      })
      .catch(() => {
        // 配额展示为旁路，失败静默（不提示用户）
      });
  };

  // 挂载时拉取一次当日配额（试用模式无登录态，/ai/quota 必 401，跳过）
  useEffect(() => {
    if (trialMode) return;
    fetchQuota();
  }, []);

  /** 会话结束后的配额刷新（试用模式下为 no-op） */
  const refreshQuota = () => {
    if (trialMode) return;
    fetchQuota();
  };

  const appendAssistant = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  };

  /** 追加注册引导卡（试用链路转化钩子）：气泡文案 + 「注册继续生成」按钮 */
  const appendRegisterGuide = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, registerGuide: true }]);
  };

  /** 终止当前会话并回到空闲态（收起浮窗时同样调用） */
  const abortSession = () => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    setPhase('idle');
    setThinking('');
    setConfirm(null);
    setError(null);
  };

  // ---------------------------------------------------------------------------
  // onResult 分派
  // ---------------------------------------------------------------------------

  /** 把 modify 应用后的快照整体写回主画布（用户拖过的坐标保留） */
  const writeSnapshotToCanvas = (snapshot: CanvasSnapshot) => {
    if (!graph) return;
    graph.fromJSON(toGraphFromJSONData(restoreSnapshotToX6Data(snapshot)));
  };

  const handleGenerateResult = (draft: AiFlowDraft) => {
    if (!graph) return;
    // 后端 FlowDraft 的 type 为 string，转换层/布局层消费归一化类型：按 RawFlowDraft / LayoutNodeLike 断言
    const layout = autoLayout(
      draft.nodes as unknown as Parameters<typeof autoLayout>[0],
      draft.edges as unknown as Parameters<typeof autoLayout>[1],
    );
    const data = flowDraftToX6(draft as unknown as FlowDraftLike, {
      positions: layout.positions,
      origin: 'ai-generate',
    });
    const existing = x6ToFlowDraft(canvasJSON(graph));
    setPreview({ data, hasExistingNodes: existing.nodes.length > 0 });
    appendAssistant(
      summarizeGeneratePreview(
        data.nodes.length,
        data.edges.length,
        data.droppedEdges.length,
        data.degradedNodeIds.length,
      ),
    );
  };

  const handleModifyResult = (operations: PatchOperation[]) => {
    if (!graph) return;
    const snapshot = snapshotFromGraphJSON(canvasJSON(graph));
    const plan = buildApplyPlan(operations, snapshot);
    if (plan.items.length === 0) {
      appendAssistant('AI 未返回可执行的修改操作，画布未变更。');
      return;
    }
    const first = plan.items[0];
    if (plan.items.length === 1 && first && first.defaultSelected && !first.ambiguous) {
      // 单项且无歧义：按规格直接应用，结果与残差如实回显
      const report = applyOperations(snapshot, operations, { plan });
      writeSnapshotToCanvas(report.snapshot);
      appendAssistant(summarizeApplyReport(report));
      return;
    }
    setModify({
      plan,
      operations,
      snapshot,
      selectedIndexes: plan.selectedIndexes,
      resolvedAmbiguous: {},
      report: null,
      applying: false,
    });
    const ambiguousCount = plan.items.filter((item) => item.ambiguous).length;
    appendAssistant(
      `AI 提出了 ${plan.items.length} 项画布修改` +
        (ambiguousCount > 0 ? `（其中 ${ambiguousCount} 项匹配存在歧义）` : '') +
        '，请在「AI 修改计划确认」面板中勾选并应用。',
    );
  };

  const handleAiResult = (result: AiResult) => {
    if (result.kind === 'consult') {
      appendAssistant(result.answer || '（AI 未返回内容）');
      return;
    }
    if (result.kind === 'generate') {
      handleGenerateResult(result.flowDraft);
      return;
    }
    // aiClient 侧 operations 为宽松 Record（网络层未校验），匹配/应用层按 PatchOperation 契约消费
    handleModifyResult(result.operations as unknown as PatchOperation[]);
  };

  // ---------------------------------------------------------------------------
  // 发送 / 确认 / 应用
  // ---------------------------------------------------------------------------

  const handleSend = (overrideText?: string) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();
    if (!text || busy) return;

    if (!graph) {
      setError('画布尚未就绪，请稍后重试');
      return;
    }

    // canvas 摘要：modify 依赖画布非空；空画布省略字段并提示走 generate
    const canvasDraft = x6ToFlowDraft(canvasJSON(graph));
    const canvas: CanvasNodeSummary[] | undefined =
      canvasDraft.nodes.length > 0 ? toCanvasSummaries(canvasDraft.nodes) : undefined;

    // 试用模式：后端 TrialChatRequestSchema 仅消费 { message, trialId }，
    // 匿名链路不携带 canvas/sessionId/projectId（服务端按 trialId 自建会话，强制 generate 意图）
    const req: ChatRequest = { message: text };
    if (trialMode) {
      req.trialId = getTrialId();
    } else {
      if (canvas) req.canvas = canvas;
      if (sessionIdRef.current) req.sessionId = sessionIdRef.current;
      if (projectId) req.projectId = projectId;
    }

    setInput('');
    setError(null);
    setThinking('');
    setPhase('running');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    lastMessageRef.current = text;
    if (!canvas) {
      appendAssistant('提示：当前画布为空，本次按「生成新流程图」处理；如需修改已有图，请先绘制或载入内容。');
    }

    sessionRef.current = runAiSession(req, {
      onThreadId: (threadId) => {
        // sessionId 在首个 thread 后固定，后续请求复用同一会话
        if (!sessionIdRef.current) sessionIdRef.current = threadId;
      },
      onThinking: (token) => {
        setThinking((prev) => prev + token);
      },
      onNeedConfirm: (payload, actions) => {
        setThinking('');
        setPhase('confirm');
        setConfirm({ payload, actions });
      },
      onResult: (result) => {
        sessionRef.current = null;
        setThinking('');
        setPhase('idle');
        handleAiResult(result);
        // 本次用量已计量，刷新当日配额展示
        refreshQuota();
      },
      onError: (message, error) => {
        sessionRef.current = null;
        setThinking('');
        setPhase('idle');
        // 试用链路被 429 拦截（TRIAL_USED / TRIAL_BUSY / TRIAL_RATE_LIMITED）：
        // 不当普通错误弹，改为对话内注册引导卡（文案用后端 message，去掉 HTTP 状态后缀）
        if (isTrialBlockError(trialMode, message, error)) {
          appendRegisterGuide(message.replace(/（HTTP \d+）\s*$/, ''));
          return;
        }
        setError(message);
        setMessages((prev) => [...prev, { role: 'assistant', content: `出错了：${message}` }]);
        // 失败的会话可能已消耗部分额度，同样刷新配额展示
        refreshQuota();
      },
    });
  };

  // /trial?q= 落地首发：画布就绪后自动发送一次（ref 防止 effect 依赖变化重发）
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    if (!initialPrompt || !graph) return;
    autoSentRef.current = true;
    handleSend(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, initialPrompt]);

  const handleRetry = () => {
    if (busy || !lastMessageRef.current) return;
    handleSend(lastMessageRef.current);
  };

  const handleDecide = (choice: ConfirmChoice, instruction?: string, candidateId?: string) => {
    // busy（phase!=='idle'）守卫防止连击重复提交；提交后回到等待态直至 onResult/onError
    if (!confirm || busy) return;
    const actions = confirm.actions;
    const body: ConfirmRequest = { choice };
    if (instruction) body.instruction = instruction;
    if (candidateId) body.candidateId = candidateId;
    const resumeToken = extractResumeToken(confirm.payload);
    if (resumeToken) body.resumeToken = resumeToken;

    setConfirm(null);
    setPhase('waiting');
    appendAssistant(
      choice === 'accept' ? '已确认采纳，等待 AI 继续处理…' : '已要求 AI 按补充说明重试，等待新方案…',
    );
    // confirm 内部失败会走 onError（此处不会 reject）
    void actions.confirm(body);
  };

  const handleApplyGenerate = () => {
    if (!graph || !preview) return;
    const merged = mergeGeneratedIntoCanvas(canvasJSON(graph), preview.data);
    graph.fromJSON(toGraphFromJSONData(merged));
    appendAssistant(
      preview.hasExistingNodes
        ? '已应用到画布：已保留原有节点，新图放在其右侧空白区域。'
        : '已应用到画布。',
    );
    setPreview(null);
    // 试用模式：草稿落本地（注册登录后首页提示条 → 编辑器无缝继承）
    if (trialMode) {
      saveTrialDraft({
        editorData: graph.toJSON().cells ?? [],
        projectName: '我的试用图',
        prompt: lastMessageRef.current ?? '',
        ts: Date.now(),
      });
      notification.success({ message: '已生成！注册登录后可保存并继续编辑' });
      appendRegisterGuide('已生成！注册登录后可保存并继续编辑。');
    }
  };

  const handleDiscardGenerate = () => {
    setPreview(null);
    appendAssistant('已放弃本次生成预览，画布未变更。');
  };

  const handleApplyModify = () => {
    if (!modify || !graph) return;
    setModify({ ...modify, applying: true });
    const report = applyOperations(modify.snapshot, modify.operations, {
      selectedIndexes: modify.selectedIndexes,
      resolvedAmbiguous: modify.resolvedAmbiguous,
    });
    writeSnapshotToCanvas(report.snapshot);
    appendAssistant(summarizeApplyReport(report));
    setModify({ ...modify, applying: false, report });
  };

  // ---------------------------------------------------------------------------
  // 渲染（Neon Dark 设计语言）
  // ---------------------------------------------------------------------------

  if (collapsed) {
    return (
      <div
        className="yt-ai-orb"
        role="button"
        aria-label="唤起 AI 流程图助手"
        title="唤起 AI 流程图助手"
        onClick={() => setCollapsed(false)}
      >
        AI
      </div>
    );
  }

  return (
    <div
      className="yt-glass-border"
      style={{
        position: 'fixed',
        // 移动端：全屏对话（顶部标题栏 / 中部消息流 / 底部输入区）
        // 桌面端：右下角固定尺寸浮窗
        ...(isMobile
          ? { inset: 0, width: '100%', display: 'flex', flexDirection: 'column' }
          : { right: 20, bottom: 20, width: 440 }),
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* 标题栏：AI 图标 + 名称 + 等宽 COPILOT 标签 + 收起 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          padding: '10px 14px',
          borderBottom: '1px solid var(--yt-border)',
          background: 'rgba(8, 12, 24, 0.45)',
        }}
      >
        <RobotOutlined
          style={{ color: 'var(--yt-accent)', fontSize: 16, filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.6))' }}
        />
        <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, color: 'var(--yt-text-primary)' }}>
          AI 流程图助手
        </span>
        <span
          className="yt-mono"
          style={{ marginLeft: 10, fontSize: 9, color: 'var(--yt-accent)', letterSpacing: '0.22em', opacity: 0.75 }}
        >
          COPILOT
        </span>
        <span style={{ flex: 1 }} />
        <Button
          type="text"
          size="small"
          style={{ color: 'var(--yt-text-muted)' }}
          onClick={() => {
            abortSession();
            setPreview(null);
            setModify(null);
            setCollapsed(true);
          }}
        >
          收起
        </Button>
      </div>

      {/* 消息区：移动端 flex-1 占满中部（全屏对话），桌面端限高 300 */}
      <div
        style={{
          padding: '12px 14px',
          overflowY: 'auto',
          ...(isMobile
            ? { flex: 1, minHeight: 0 }
            : { maxHeight: 300, minHeight: 96 }),
        }}
      >
        {messages.length === 0 ? (
          <div style={{ padding: '2px 0 6px' }}>
            <div style={{ fontSize: 13, color: 'var(--yt-text-secondary)', lineHeight: 1.7, marginBottom: 12 }}>
              描述你的流程图需求，AI 会先给出
              <span style={{ color: 'var(--yt-accent)' }}>生成计划</span>
              ，确认后自动绘制到画布；生成后可继续对话修改。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_PROMPTS.map((preset) => (
                <span
                  key={preset.label}
                  className="yt-chip"
                  title={preset.text}
                  onClick={() => handleSend(preset.text)}
                >
                  {preset.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 8,
              }}
            >
              {message.registerGuide ? (
                // 注册引导卡：试用链路转化钩子（文案 + 注册 CTA）
                <div
                  className="yt-bubble-ai"
                  style={{
                    borderColor: 'rgba(34, 211, 238, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <div>{message.content}</div>
                  <Link to="/register">
                    <Button size="small" type="primary" className="yt-btn-primary">
                      注册继续生成
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className={message.role === 'user' ? 'yt-bubble-user' : 'yt-bubble-ai'}>
                  {message.content}
                </div>
              )}
            </div>
          ))
        )}
        {phase === 'running' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div className="yt-bubble-ai" style={{ borderColor: 'rgba(34, 211, 238, 0.25)' }}>
              <div
                className="yt-mono"
                style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--yt-accent)', opacity: 0.8, marginBottom: 4 }}
              >
                THINKING
              </div>
              <div className="yt-thinking">{thinking || '正在分析需求，规划节点与连接结构…'}</div>
            </div>
          </div>
        ) : null}
        {phase === 'waiting' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div className="yt-bubble-ai" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spin size="small" />
              <span style={{ fontSize: 12, color: 'var(--yt-text-secondary)' }}>AI 正在执行，请稍候…</span>
            </div>
          </div>
        ) : null}
      </div>

      {confirm ? (
        <div style={{ padding: '0 14px', marginBottom: 10, flexShrink: 0 }}>
          <HumanConfirmCard payload={confirm.payload} submitting={false} onDecide={handleDecide} />
        </div>
      ) : null}

      {preview ? (
        <div
          style={{
            margin: '0 14px 10px',
            border: '1px solid var(--yt-border)',
            borderRadius: 10,
            padding: 10,
            flexShrink: 0,
            background: 'rgba(13, 19, 38, 0.6)',
          }}
        >
          <div
            className="yt-mono"
            style={{ fontSize: 10, color: 'var(--yt-text-secondary)', marginBottom: 8, letterSpacing: '0.12em' }}
          >
            生成预览 · 只读，尚未写入画布
          </div>
          <X6FlowPreview data={preview.data} height={220} />
          <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button size="small" onClick={handleDiscardGenerate} disabled={busy}>
              放弃
            </Button>
            <Button size="small" type="primary" className="yt-btn-primary" onClick={handleApplyGenerate} disabled={busy}>
              应用到画布
            </Button>
          </Space>
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '0 14px', marginBottom: 8, flexShrink: 0 }}>
          <Alert
            type="error"
            showIcon
            style={{ borderRadius: 10 }}
            message="AI 请求失败"
            description={error}
            action={
              <Button size="small" danger onClick={handleRetry} disabled={busy}>
                重试
              </Button>
            }
          />
        </div>
      ) : null}

      {/* 输入区 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          flexShrink: 0,
          padding: '10px 14px',
          borderTop: '1px solid var(--yt-border)',
          background: 'rgba(8, 12, 24, 0.45)',
        }}
      >
        <Input.TextArea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="描述流程图需求，Enter 发送，Shift+Enter 换行"
          autoSize={{ minRows: 1, maxRows: 3 }}
          disabled={busy}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          style={{
            flex: 1,
            background: 'rgba(30, 41, 66, 0.55)',
            borderColor: 'var(--yt-border)',
            color: 'var(--yt-text-primary)',
            borderRadius: 10,
          }}
        />
        <Button type="primary" className="yt-btn-primary" loading={busy} disabled={busy} onClick={() => handleSend()}>
          发送
        </Button>
      </div>

      {/* 配额（等宽技术标签）；试用模式固定展示试用说明（不拉取 /ai/quota） */}
      {trialMode || quotaText ? (
        <div
          className="yt-mono"
          style={{
            padding: '6px 14px 10px',
            fontSize: 10,
            color: 'var(--yt-text-muted)',
            textAlign: 'right',
            letterSpacing: '0.1em',
            flexShrink: 0,
            background: 'rgba(8, 12, 24, 0.45)',
          }}
        >
          {trialMode ? '试用模式 · 注册后每日 3 次' : quotaText}
        </div>
      ) : null}

      <ModifyPlanModal
        open={modify !== null}
        plan={modify?.plan ?? { items: [], snapshot: { nodes: [], edges: [] }, selectedIndexes: [], blockedIndexes: [] }}
        selectedIndexes={modify?.selectedIndexes ?? []}
        resolvedAmbiguous={modify?.resolvedAmbiguous ?? {}}
        report={modify?.report ?? null}
        applying={modify?.applying ?? false}
        onSelectionChange={(next) => {
          setModify((prev) => (prev ? { ...prev, selectedIndexes: next } : prev));
        }}
        onResolutionChange={(next) => {
          setModify((prev) => (prev ? { ...prev, resolvedAmbiguous: next } : prev));
        }}
        onConfirm={handleApplyModify}
        onClose={() => setModify(null)}
      />
    </div>
  );
}
