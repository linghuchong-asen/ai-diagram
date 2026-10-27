// 语图技术方案 - Task 5：AI 浮窗挂载与人在回路 UI（Neon Dark 科技感版本）
// 数据链路（全部经 utils/aiClient.runAiSession，浮窗内不再自建 chat / EventSource / 轮询）：
//   发送：message + canvas（graph.toJSON() → x6ToFlowDraft → CanvasNodeSummary[]，空画布省略）
//         + sessionId（首个 thread 后固定）+ projectId（x6Editor 路由参数）
//         + formHint（multi-artifact-batch：快捷 chips 显式指定产物形态时携带）
//   onThinking 思考 token 流式展示 → onNeedConfirm 渲染确认卡片（ConfirmActions.confirm 提交裁决）
//   → onResult 分派：
//     generate(flowchart，缺省)：autoLayout → flowDraftToX6(origin 'ai-generate') → 浮窗内只读 X6 预览，
//               点「应用到画布」后写入主图（画布非空时保留既有节点并整体右移避让）；
//     generate(mindmap，multi-artifact-batch)：layoutMindmap 整洁树布局 → process 节点 FlowDraft →
//               同一 flowDraftToX6 预览/应用链路（进画布后可用全套流程图编辑能力）；
//     generate(table/checklist/timeline，multi-artifact-batch)：归一化后在消息流内渲染
//               （表格/可勾选清单/时间线，Neon Dark 自绘 markup），附「复制 Markdown」出口，不落画布；
//     modify：snapshotFromGraphJSON → buildApplyPlan → 有歧义或多项时弹 ModifyPlanModal
//             （承载 ApplyPlanPanel），确认后 applyOperations → 残差显式展示（归因）→
//             report.snapshot 拼回 X6（origin 'ai-modify'）→ graph.fromJSON；
//             单项且无歧义时直接应用（ApplyPlanPanel 面板仅歧义/多项时弹出）；
//     consult：answer 直接展示。
//   生命周期：卸载/收起时 session.abort()；发送中禁用重复提交；onError 展示可读信息 + 重试。
// 注意：confirm 请求体的补充约束字段名是 instruction（非 message），resumeToken 随 payload 透传。
// UI 设计语言：Neon Dark（近黑深蓝玻璃 + 电光青强调 + 等宽技术标签 + 思考流打字光标），
//   快捷提示词 chips 源自竞品调研（Eraser presets / Napkin 无门槛生成），点击即发送；
//   multi-artifact-batch 追加四种产物形态示例 chips（方案对比表/会议待办/旅行时间线/读书导图）。
// competitor-driven-evolution-batch Round 12：generate 结果同步落「本地草稿箱」
//   （localStorage 跨会话最近 20 条），标题栏「历史产物」弹窗支持回放（不耗额度）/复制/下载/删除。

import { useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import { Alert, Button, Input, Modal, Space, Spin, notification } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
// 会员到期提醒（vip-renewal-reminder-batch）：剩余天数与续费文案纯函数
import { vipDaysLeft, vipRenewalText } from '../preView/monetize';
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
import type { ArtifactKind } from '../../utils/aiClient';
import { autoLayout } from './layout/auto-layout';
import { flowDraftToX6, x6ToFlowDraft, type FlowDraftLike, type FlowDraftToX6Result } from './transform/to-x6';
import type { PatchOperation, X6GraphJSON } from './transform/types';
import { snapshotFromGraphJSON, type CanvasSnapshot } from './match/match-level';
import { applyOperations, buildApplyPlan, type ApplyPlan, type ApplyReport } from './match/apply-operations';
import HumanConfirmCard from './confirm-card/human-confirm-card';
import X6FlowPreview from './preview/x6-preview-canvas';
import ModifyPlanModal from './modify/modify-plan-modal';
// multi-artifact-batch：多形态产物的提取/摘要/布局/渲染
import { extractArtifact, summarizeArtifact, generatePayloadOf, ARTIFACT_KIND_LABEL, type ExtractedArtifact } from './artifacts/artifact-meta';
import { layoutMindmap, mindmapToFlowDraftLike } from './artifacts/mindmap-layout';
import ArtifactBubble from './artifacts/renderers/artifact-bubble';
// competitor-driven-evolution-batch Round 5/8/11/12：DSL 导入 + 追问建议 + 版本历史 + 本地草稿箱
import { importDsl } from './import/dsl-detect';
import { suggestFollowups, type FollowupSuggestion } from './artifacts/followup-suggest';
// Round 10/12：产物 Markdown 构建（草稿箱复制出口复用）与复制/下载按钮组件
import { buildArtifactMarkdown } from './artifacts/download-artifact';
import ArtifactCopyButton, { ArtifactDownloadButton } from './artifacts/renderers/artifact-copy';
// Round 12：本地草稿箱（localStorage 跨会话产物历史,纯逻辑在 utils/artifact-drafts.ts）
import {
  saveArtifactDraft,
  listArtifactDrafts,
  removeArtifactDraft,
  clearArtifactDrafts,
  type ArtifactDraft,
} from '../../utils/artifact-drafts';
import {
  createHistory,
  pushHistory,
  stepHistory,
  historyCurrent,
  historyLabelFor,
  type HistoryState,
} from './session/history-stack';
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
  /** 初始产物形态（/trial?form= 落地,Round 18）：首发时作为 formHint 直通（白名单外忽略） */
  initialFormHint?: ArtifactKind;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 注册引导卡（试用链路 429 拦截 / 应用成功后的转化钩子）：气泡内附带「注册继续生成」按钮 */
  registerGuide?: boolean;
  /** 额度用尽引导卡（快赢批次一 QW7）：气泡内附三条出路（分享领次数/模板中心/明日再来） */
  quotaGuide?: boolean;
  /** multi-artifact-batch：非画布产物（table/checklist/timeline）在气泡内渲染的结构化数据 */
  artifact?: ExtractedArtifact;
  /** competitor-driven-evolution-batch Round 8：产物生成后的追问建议 chips（点击即发送） */
  suggestions?: FollowupSuggestion[];
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
  /** 商业化闭环批次：会员在期标记（额度展示「会员」标识） */
  vip?: boolean;
  vipExpireTime?: string | null;
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

/** 快捷提示词（空状态引导）：点击即发送，降低首次使用门槛。
 *  multi-artifact-batch：新增四种产物形态示例（formHint 显式指定形态，直达新能力）。 */
const PRESET_PROMPTS: Array<{ label: string; text: string; formHint?: ArtifactKind }> = [
  {
    label: '请假审批流程',
    text: '帮我生成一个员工请假审批流程图：员工提交请假申请，直属主管审批，超过 3 天需要部门总监复核，通过后人事备案，驳回则修改后重新提交。',
  },
  {
    label: '电商订单流程',
    text: '帮我生成一个电商订单处理流程图：用户下单、支付、库存校验、风控审核、发货、物流签收，支持退款分支。',
  },
  {
    label: '方案对比表',
    text: '帮我对比「自建」和「采购」两个方案：从成本、工期、维护性、风险几个维度展开，最后给出推荐结论。',
    formHint: 'table',
  },
  {
    label: '会议待办清单',
    text: '把项目周会内容整理成分组待办清单：上线前检查（回归测试、数据库备份、回滚预案）、上线后动作（监控观察、群公告）。',
    formHint: 'checklist',
  },
  {
    label: '旅行时间线',
    text: '帮我安排成都三天两晚的行程时间线：第一天武侯祠锦里和火锅，第二天大熊猫基地和宽窄巷子，第三天人民公园和返程。',
    formHint: 'timeline',
  },
  {
    label: '读书思维导图',
    text: '把《红楼梦》的知识体系整理成思维导图：四大家族关系、主要人物、经典情节、主题思想。',
    formHint: 'mindmap',
  },
];

/** graph.toJSON() 返回 X6 运行时 Cell.Properties，结构与转换层的宽松 X6GraphJSON 兼容 */
function canvasJSON(graph: Graph | undefined): X6GraphJSON | undefined {
  if (!graph) return undefined;
  return graph.toJSON() as unknown as X6GraphJSON;
}

/** 试用 429 拦截的已知文案片段（后端全局异常过滤器会把响应体 code 重写为 -1，字符串 code 无法透出，按文案兜底识别）
 *  快赢批次一：TRIAL_USED 文案更新为「今日免费试用次数已用完…」，片段同步对齐 */
const TRIAL_BLOCK_MESSAGE_FRAGMENTS = ['免费试用次数已用完', '试用次数已用完', '今日试用名额已满', '操作过于频繁'];

/** 登录态配额 429（AI_QUOTA_EXCEEDED）的识别：优先错误码，文案片段兜底（同上原因） */
const QUOTA_EXCEEDED_MESSAGE_FRAGMENTS = ['今日 AI 配额已用完'];

/** 判定是否为登录态配额用尽（AI_QUOTA_EXCEEDED）：触发 QW7 三选一引导卡 */
function isQuotaExceededError(trialMode: boolean, message: string, error: unknown): boolean {
  if (trialMode) return false;
  if (pickErrorCode(error) === 'AI_QUOTA_EXCEEDED') return true;
  const status = error instanceof HttpError ? error.status : undefined;
  return status === 429 && QUOTA_EXCEEDED_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

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

export default function AiFloatWindow({ graph, projectId, trialMode = false, initialPrompt, initialFormHint }: AiFloatWindowProps) {
  // 移动端轻客户端策略：窄屏下浮窗切换为全屏对话（移动端主场景即「对话生成」）
  const isMobile = useIsMobile();
  const navigate = useNavigate();
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
  /** DSL 导入弹窗（Round 5）：粘贴 Mermaid/PlantUML 源码 → 识别方言 → 解析进画布预览 */
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  /** 会话内产物版本历史（Round 11）：generate 结果按版本入栈,支持上一版/下一版回看 */
  const [history, setHistory] = useState<HistoryState>(createHistory());
  /** 本地草稿箱弹窗（Round 12）：跨会话产物历史（localStorage 最近 20 条,打开时快照） */
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);

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
          `今日额度${data.vip ? " · 会员" : ""} 生成 ${data.generateCount}/${data.generateLimit} · 修改 ${data.modifyCount}/${data.modifyLimit}`,
        );
        // 会员到期提醒（vip-renewal-reminder-batch）：在期算剩余天数，≤3 天进入续费提醒态
        setVipDaysLeft(data.vip ? vipDaysLeft(data.vipExpireTime) : null);
      })
      .catch(() => {
        // 配额展示为旁路，失败静默（不提示用户）
      });
  };

  // ---------------------------------------------------------------------------
  // 每日签到（留存与裂变加强批次：连签满 7 天整数倍送 1 天会员）
  // ---------------------------------------------------------------------------

  /** /ai/checkin 响应（与后端 CheckinStatusView/CheckinResultView 契约对齐） */
  interface CheckinStatus {
    checkedToday: boolean;
    streak: number;
  }

  const [checkinState, setCheckinState] = useState<CheckinStatus | null>(null);
  const [checking, setChecking] = useState(false);
  /** 会员剩余天数（vip-renewal-reminder-batch）：null = 非会员；≤3 天进入续费提醒态 */
  const [vipDaysLeftState, setVipDaysLeft] = useState<number | null>(null);

  /** 拉取签到状态（旁路，失败静默按未签展示） */
  const fetchCheckin = () => {
    http<CheckinStatus>('/ai/checkin')
      .then((response) => {
        if (response.code === 0 && response.data) setCheckinState(response.data);
      })
      .catch(() => undefined);
  };

  /** 签到：当日首次发额度 +1；连签满 7 天整数倍触发会员 +1 天 */
  const handleCheckin = async () => {
    if (checking || checkinState?.checkedToday) return;
    setChecking(true);
    try {
      const response = await http<CheckinStatus & { alreadyChecked: boolean; bonusGranted: boolean; vipRewarded: boolean }>('/ai/checkin', {
        method: 'post',
      });
      const result = response.data;
      if (result) {
        setCheckinState({ checkedToday: true, streak: result.streak });
        if (result.vipRewarded) {
          notification.success({
            message: `连签 ${result.streak} 天，会员 +1 天！`,
            description: '全站免水印 + 每日 30 次生成已生效',
          });
        } else if (result.bonusGranted) {
          notification.success({ message: '签到成功，今日生成额度 +1' });
        }
        fetchQuota();
      }
    } catch {
      // 签到失败由 http 层统一提示；按钮可重试
    } finally {
      setChecking(false);
    }
  };

  // 挂载时拉取一次当日配额与签到状态（试用模式无登录态，均 401，跳过）
  useEffect(() => {
    if (trialMode) return;
    fetchQuota();
    fetchCheckin();
  }, []);

  /** 会话结束后的配额刷新（试用模式下为 no-op） */
  const refreshQuota = () => {
    if (trialMode) return;
    fetchQuota();
  };

  const appendAssistant = (content: string, suggestions?: FollowupSuggestion[]) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, suggestions }]);
  };

  /** 追加注册引导卡（试用链路转化钩子）：气泡文案 + 「注册继续生成」按钮 */
  const appendRegisterGuide = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, registerGuide: true }]);
  };

  /** 追加额度用尽引导卡（快赢批次一 QW7）：三条出路替代硬报错 */
  const appendQuotaGuide = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, quotaGuide: true }]);
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
      suggestFollowups('flowchart'),
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

  const handleAiResult = (result: AiResult, options?: { record?: boolean }) => {
    // Round 11：generate 结果入版本历史（回看旧版时不重复入栈）
    const record = options?.record !== false;
    if (result.kind === 'consult') {
      appendAssistant(result.answer || '（AI 未返回内容）');
      return;
    }
    if (result.kind === 'generate') {
      if (record) {
        setHistory((prev) => {
          const version = prev.entries.length + 1;
          return pushHistory(prev, result, historyLabelFor(result, version), Date.now(), `h${version}-${Date.now()}`);
        });
        // Round 12：同步落本地草稿箱（跨会话回看;存储不可用/配额超限时静默失败,不影响主链路）
        saveArtifactDraft(result);
      }
      // multi-artifact-batch：按 artifactKind 分发（缺省 flowchart 走既有链路，行为不变）
      const artifact = extractArtifact(result);
      if (result.artifactKind && result.artifactKind !== 'flowchart') {
        if (artifact?.kind === 'mindmap') {
          handleMindmapResult(result.mindmapDraft);
          return;
        }
        if (artifact) {
          // 非画布产物：结构化数据进消息流渲染（表格/清单/时间线）+ 追问建议（Round 8）
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: summarizeArtifact(artifact), artifact, suggestions: suggestFollowups(artifact.kind) },
          ]);
          return;
        }
        // 声明了形态但数据不可用：如实提示（不静默吞掉）
        appendAssistant('本次生成的结构化内容不完整，已放弃渲染。可以换个说法重试，或补充更多材料。');
        return;
      }
      // flowchart 既有链路（result.flowDraft 兼容期可能为 undefined,由调用方契约保证存在）
      handleGenerateResult(result.flowDraft as AiFlowDraft);
      return;
    }
    // aiClient 侧 operations 为宽松 Record（网络层未校验），匹配/应用层按 PatchOperation 契约消费
    handleModifyResult(result.operations as unknown as PatchOperation[]);
  };

  /**
   * multi-artifact-batch：思维导图结果 → 画布预览链路。
   * 复用 flowchart 的「预览 → 应用到画布」体系：树 → 整洁树布局坐标 → process 节点 FlowDraft →
   * flowDraftToX6（同一转换层，脑图进画布后可继续用全套流程图编辑能力）。
   */
  const handleMindmapResult = (draftRaw: unknown) => {
    if (!graph) return;
    const extracted = extractArtifact({ kind: 'generate', artifactKind: 'mindmap', mindmapDraft: draftRaw as never });
    if (!extracted || extracted.kind !== 'mindmap') {
      appendAssistant('思维导图内容不完整，已放弃渲染。可以换个说法重试。');
      return;
    }
    const draft = extracted.payload;
    const layout = layoutMindmap(draft);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of layout.nodes) positions[node.id] = { x: node.x, y: node.y };
    const data = flowDraftToX6(mindmapToFlowDraftLike(draft) as unknown as FlowDraftLike, {
      positions,
      origin: 'ai-generate',
    });
    const existing = x6ToFlowDraft(canvasJSON(graph));
    setPreview({ data, hasExistingNodes: existing.nodes.length > 0 });
    appendAssistant(summarizeArtifact(extracted), suggestFollowups('mindmap'));
  };

  /**
   * competitor-driven-evolution-batch Round 5：粘贴 DSL 导入。
   * 识别 Mermaid/PlantUML → 解析为语义 FlowDraft → 走与 AI 生成完全相同的
   * autoLayout + flowDraftToX6 预览链路（确认后应用、可放弃），降级明细如实回显。
   */
  const handleImportDsl = () => {
    if (!graph || !importText.trim()) return;
    const { dialect, parse } = importDsl(importText);
    if (!dialect || !parse.ok || !parse.draft) {
      setError(parse.warnings[0] ?? '无法识别粘贴的 DSL 内容');
      return;
    }
    const draft = parse.draft;
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
    const warnNote = parse.warnings.length
      ? `（${parse.warnings.length} 处语法已降级容忍：${parse.warnings.slice(0, 2).join('；')}）`
      : '';
    appendAssistant(
      `已解析 ${dialect === 'mermaid' ? 'Mermaid' : 'PlantUML'} 流程：${draft.nodes.length} 个节点、${draft.edges.length} 条连接${warnNote}。预览确认后可应用到画布。`,
    );
    setImportOpen(false);
    setImportText('');
    setError(null);
  };

  // ---------------------------------------------------------------------------
  // 发送 / 确认 / 应用
  // ---------------------------------------------------------------------------

  const handleSend = (overrideText?: string, formHint?: ArtifactKind) => {
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

    // 试用模式：后端 TrialChatRequestSchema 消费 { message, trialId, formHint }，
    // 匿名链路不携带 canvas/sessionId/projectId（服务端按 trialId 自建会话，强制 generate 意图）
    const req: ChatRequest = { message: text };
    // multi-artifact-batch：快捷 chips/显式选择产物形态时携带 formHint（后端白名单校验）
    if (formHint) req.formHint = formHint;
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
    // 空画布提示仅对流程图/未指定形态的生成有意义（表格/清单/时间线本就不落画布）
    if (!canvas && (!formHint || formHint === 'flowchart')) {
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
          appendRegisterGuide(
            `${message.replace(/（HTTP \d+）\s*$/, '')}\n注册后可保存这幅图并继续编辑，还能每日生成 3 次。`,
          );
          return;
        }
        // 快赢批次一(QW7)：登录态配额用尽 → 三选一引导卡（分享领次数/模板中心/明日再来），
        // 替代硬报错 —— 把「撞墙」转化为转化与留存的出口
        if (isQuotaExceededError(trialMode, message, error)) {
          appendQuotaGuide(message.replace(/（HTTP \d+）\s*$/, ''));
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
  // Round 18:模板中心多形态卡片经 ?form= 带来 initialFormHint,首发时直通形态(FormRouter 零路由)
  // Round 19:同页换 q（试用页空态引导/模板跳转）视为新的用户动作——同一 prompt+form 不重发,
  //   新组合才发送;发送中(busy)先挂起,回到空闲后自动补发,避免连点丢请求
  const autoSentRef = useRef<string | null>(null);
  const autoSendKey = initialFormHint ? `${initialPrompt}|${initialFormHint}` : (initialPrompt ?? '');
  useEffect(() => {
    if (!initialPrompt || !graph || busy) return;
    if (autoSentRef.current === autoSendKey) return;
    autoSentRef.current = autoSendKey;
    handleSend(initialPrompt, initialFormHint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, initialPrompt, initialFormHint, busy]);

  const handleRetry = () => {
    if (busy || !lastMessageRef.current) return;
    handleSend(lastMessageRef.current);
  };

  /** Round 11：版本回看——步进游标并按「不记录」模式重放该版本的渲染分发 */
  const handleHistoryStep = (delta: number) => {
    if (busy) return;
    const next = stepHistory(history, delta);
    if (next === history) return; // 越界短路
    setHistory(next);
    const entry = historyCurrent(next);
    if (entry) {
      appendAssistant(`已切换到「${entry.label}」。`);
      handleAiResult(entry.payload, { record: false });
    }
  };

  // ---------------------------------------------------------------------------
  // 本地草稿箱（Round 12）：跨会话产物历史
  // ---------------------------------------------------------------------------

  /** 草稿时间展示（MM-DD HH:mm,列表空间有限取短格式） */
  const formatDraftTime = (at: number): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = new Date(at);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  /** 打开草稿箱：打开时快照一次,列表内删除/清空即时更新视图 */
  const openDraftsModal = () => {
    setDrafts(listArtifactDrafts());
    setDraftsOpen(true);
  };

  /** 草稿回放：不重跑 AI、不消耗额度,按「不记录」模式重放渲染分发后关闭弹窗 */
  const handleReplayDraft = (entry: ArtifactDraft) => {
    if (busy) return;
    handleAiResult(entry.payload, { record: false });
    appendAssistant(`已回放本机历史产物（${ARTIFACT_KIND_LABEL[entry.kind]}，不消耗额度）。`);
    setDraftsOpen(false);
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
          background: 'rgba(16, 17, 19, 0.92)',
        }}
      >
        <RobotOutlined
          style={{ color: 'var(--yt-accent)', fontSize: 16 }}
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
          onClick={openDraftsModal}
          title="查看本机保存的历史产物（跨会话,最近 20 条）"
        >
          历史产物
        </Button>
        <Button
          type="text"
          size="small"
          style={{ color: 'var(--yt-text-muted)' }}
          onClick={() => setImportOpen(true)}
          title="粘贴 Mermaid / PlantUML 源码导入为流程图"
        >
          导入DSL
        </Button>
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
              描述你的问题，AI 会选择最合适的形态：
              <span style={{ color: 'var(--yt-accent)' }}>流程图</span>、
              <span style={{ color: 'var(--yt-accent)' }}>思维导图</span>、
              <span style={{ color: 'var(--yt-accent)' }}>对比表格</span>、
              <span style={{ color: 'var(--yt-accent)' }}>清单</span> 或
              <span style={{ color: 'var(--yt-accent)' }}>时间线</span>
              ；也可以点下方示例直接体验。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_PROMPTS.map((preset) => (
                <span
                  key={preset.label}
                  className="yt-chip"
                  title={preset.text}
                  onClick={() => handleSend(preset.text, preset.formHint)}
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
                    borderColor: 'var(--yt-border-bright)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 10,
                    whiteSpace: 'pre-line',
                  }}
                >
                  <div>{message.content}</div>
                  <Link to="/register">
                    <Button size="small" type="primary" className="yt-btn-primary">
                      注册保存这幅图
                    </Button>
                  </Link>
                </div>
              ) : message.quotaGuide ? (
                // 额度用尽引导卡（快赢批次一 QW7）：三条出路 —— 分享领次数 / 模板中心（不耗额度）/ 明日再来
                <div
                  className="yt-bubble-ai"
                  style={{
                    borderColor: 'rgba(129, 140, 248, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <div style={{ whiteSpace: 'pre-line' }}>{message.content}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {projectId ? (
                      <Button size="small" type="primary" className="yt-btn-primary" onClick={() => navigate(`/preview/${projectId}`)}>
                        去分享，领 +1 次
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => navigate('/templates')}>
                      模板中心（不耗额度）
                    </Button>
                    <Button size="small" type="text" style={{ color: 'var(--yt-text-muted)' }} disabled>
                      明日再来
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={message.role === 'user' ? 'yt-bubble-user' : 'yt-bubble-ai'}>
                  {message.content}
                  {message.artifact ? (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--yt-border)' }}>
                      <ArtifactBubble artifact={message.artifact} />
                    </div>
                  ) : null}
                  {message.suggestions && message.suggestions.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {message.suggestions.map((suggestion) => (
                        <span
                          key={suggestion.label}
                          className="yt-chip"
                          title={suggestion.prompt}
                          onClick={() => handleSend(suggestion.prompt, suggestion.formHint)}
                        >
                          {suggestion.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        {phase === 'running' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div className="yt-bubble-ai" style={{ borderColor: 'var(--yt-border)' }}>
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
            background: 'rgba(16, 17, 19, 0.85)',
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

      {/* 版本历史条（Round 11）：多版本时展示,上一版/下一版回看（不消耗额度,纯本地回放） */}
      {history.entries.length > 1 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 14px 6px',
            flexShrink: 0,
            borderTop: '1px solid var(--yt-border)',
            background: 'rgba(16, 17, 19, 0.92)',
          }}
        >
          <span className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-text-muted)', letterSpacing: '0.1em' }}>
            VERSION {history.cursor + 1}/{history.entries.length}
          </span>
          <span style={{ flex: 1 }} />
          <Button size="small" disabled={busy || history.cursor <= 0} onClick={() => handleHistoryStep(-1)}>
            上一版
          </Button>
          <Button
            size="small"
            disabled={busy || history.cursor >= history.entries.length - 1}
            onClick={() => handleHistoryStep(1)}
          >
            下一版
          </Button>
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
          background: 'rgba(16, 17, 19, 0.92)',
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
            background: 'rgba(255, 255, 255, 0.04)',
            borderColor: 'var(--yt-border)',
            color: 'var(--yt-text-primary)',
            borderRadius: 10,
          }}
        />
        <Button type="primary" className="yt-btn-primary" loading={busy} disabled={busy} onClick={() => handleSend()}>
          发送
        </Button>
      </div>

      {/* 配额（等宽技术标签）+ 每日签到（留存与裂变加强批次）；试用模式固定展示试用说明 */}
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
            background: 'rgba(16, 17, 19, 0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <span>{trialMode ? '免费试用每日 2 次 · 注册后每日 3 次' : quotaText}</span>
          {/* 会员到期提醒（vip-renewal-reminder-batch）：≤3 天警示 + 直达 /pricing 续费；常态展示剩余天数 */}
          {!trialMode && vipRenewalText(vipDaysLeftState) && (
            <span
              className="yt-chip"
              style={{
                color: 'var(--yt-accent)',
                cursor: (vipDaysLeftState ?? 99) <= 3 ? 'pointer' : 'default',
                border: (vipDaysLeftState ?? 99) <= 3 ? '1px solid var(--yt-accent)' : undefined,
              }}
              title={
                (vipDaysLeftState ?? 99) <= 3
                  ? '会员即将到期，续费自动顺延 30 天，不丢剩余天数'
                  : '会员生效中'
              }
              onClick={() => {
                if ((vipDaysLeftState ?? 99) <= 3) navigate('/pricing');
              }}
            >
              {vipRenewalText(vipDaysLeftState)}
            </span>
          )}
          {/* 签到：当日未签显示「签到 +1」；已签显示连签天数（streak 满 7 天整数倍自动送会员天数） */}
          {!trialMode && checkinState && (
            checkinState.checkedToday ? (
              <span
                className="yt-chip"
                style={{ color: 'var(--yt-accent)', cursor: 'default' }}
                title={`已连续签到 ${checkinState.streak} 天；每满 7 天送 1 天会员`}
              >
                已连签 {checkinState.streak} 天
              </span>
            ) : (
              <span
                className="yt-chip"
                style={{ color: 'var(--yt-accent)' }}
                onClick={handleCheckin}
                title="每日签到 +1 次生成；连签满 7 天送 1 天会员"
              >
                {checking ? '签到中…' : '签到 +1'}
              </span>
            )
          )}
        </div>
      ) : null}

      {/* DSL 导入弹窗（Round 5）：粘贴 Mermaid/PlantUML → 识别方言 → 解析进预览 */}
      <Modal
        visible={importOpen}
        title="粘贴 DSL 导入"
        okText="解析并预览"
        cancelText="取消"
        onOk={handleImportDsl}
        onCancel={() => setImportOpen(false)}
        okButtonProps={{ disabled: !importText.trim() }}
      >
        <div style={{ fontSize: 12, color: 'var(--yt-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
          支持粘贴 Mermaid 流程图（<code>graph TD</code> / <code>flowchart LR</code>）与 PlantUML activity
         （<code>@startuml ... @enduml</code>）；可直接带 ``` 代码块围栏。解析后先进预览，确认才写入画布。
        </div>
        <Input.TextArea
          rows={9}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'graph TD\nA[开始] --> B{条件?}\nB -->|是| C[执行]\nB -->|否| D[驳回]'}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      {/* 本地草稿箱弹窗（Round 12）：跨会话历史产物列表（回放/复制/下载/删除/清空） */}
      <Modal visible={draftsOpen} title="历史产物（本机草稿箱）" footer={null} onCancel={() => setDraftsOpen(false)}>
        <div style={{ fontSize: 12, color: 'var(--yt-text-secondary)', marginBottom: 10, lineHeight: 1.7 }}>
          最近 20 条生成产物自动保存在本机浏览器（不占云端空间）；回放不重跑 AI、不消耗额度。
        </div>
        {drafts.length === 0 ? (
          <div style={{ padding: '22px 0', textAlign: 'center', color: 'var(--yt-text-muted)', fontSize: 12 }}>
            暂无历史产物，生成后自动保存到本机。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {drafts.map((entry) => {
              // payload 与形态不配对（理论不发生,校验闸已过滤）时隐藏复制/下载出口
              const payload = generatePayloadOf(entry.payload);
              const markdown = payload !== null ? buildArtifactMarkdown(entry.kind, payload) : null;
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    border: '1px solid var(--yt-border)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--yt-text-primary)' }}>
                    {ARTIFACT_KIND_LABEL[entry.kind]}
                  </span>
                  <span className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-text-muted)' }}>
                    {formatDraftTime(entry.at)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button size="small" disabled={busy} onClick={() => handleReplayDraft(entry)}>
                    回放
                  </Button>
                  {markdown !== null ? <ArtifactCopyButton text={markdown} label="复制" /> : null}
                  {payload !== null ? <ArtifactDownloadButton kind={entry.kind} payload={payload} label="下载" /> : null}
                  <Button size="small" type="text" danger onClick={() => setDrafts(removeArtifactDraft(entry.id))}>
                    删除
                  </Button>
                </div>
              );
            })}
            <Button
              size="small"
              type="text"
              danger
              style={{ alignSelf: 'flex-end' }}
              onClick={() => {
                clearArtifactDrafts();
                setDrafts([]);
              }}
            >
              清空草稿箱
            </Button>
          </div>
        )}
      </Modal>

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
