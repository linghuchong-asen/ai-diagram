// 语图技术方案 - 反思失败后的局部修正(Rewriter)(Task 9.2)
// 文档:失败 → 返回生成节点,附失败原因走 Rewriter 局部修正(不重走完整主流程)
// 关键原则:
//   1) 局部修正:提示词里只列「与问题相关的节点/边」,并明确禁止改动无关部分,避免模型整图重写导致漂移;
//   2) 只喂 error 级问题:warning(如合法回环 HAS_CYCLE)不进修正提示,防止模型把对的改错;
//   3) 输出契约不变:仍然只输出 JSON。
import { Injectable } from '@nestjs/common';
import { ReflectionIssue } from './evaluator';
import { REFLECT_SYSTEM_PROMPT } from '../prompts/reflect.prompt';
import { HUMAN_CONFIRM_FALLBACK_PROMPT, TOOL_DEGRADE_PROMPT } from '../prompts/fallback.prompt';
import { ArtifactKind } from '../schemas/artifact.schema';

export interface RewriteRequest {
  intent: 'generate' | 'modify';
  rawOutput: string;
  issues: ReflectionIssue[];
  canvasSummary?: string;
  /** 当前草稿的节点/边摘要(generate 场景用于定位局部修正范围) */
  draftSummary?: string;
  /**
   * multi-artifact-batch:非 flowchart 产物形态。设置后修正提示词的措辞按形态调整
   * (如「元素」替代「节点与边」),并附带该形态的校验要点,避免用流程图文案误导模型。
   */
  artifactKind?: ArtifactKind;
}

export interface RewriteResult {
  corrected: string;
  ok: boolean;
}

/** 人在回路确认载荷(Task 9.2):超限后交给用户裁决 */
export interface HumanConfirmPayload {
  /** 为什么需要人工确认 */
  reason: string;
  /** 未解决的 error 级问题列表 */
  issues: Array<{ layer: string; type?: string; message: string; nodeIds?: string[] }>;
  /** 候选修正方案(至少 1 个,便于用户「直接采用」) */
  candidates: Array<{
    id: string;
    label: string;
    /** 候选内容:generate 场景是 FlowDraft,modify 场景是 operations */
    data?: unknown;
    /** 候选说明:告诉用户采用它会有什么后果 */
    note?: string;
  }>;
}

@Injectable()
export class Rewriter {
  /** 构造局部修正提示词 */
  buildCorrectionPrompt(req: RewriteRequest): string {
    // 只保留 error 级问题;warning(合法回环等)不触发修正
    const blocking = (req.issues ?? []).filter((i) => (i.severity ?? 'error') === 'error');
    const issueText = blocking.length
      ? blocking.map((i) => `- [${i.layer}${i.type ? `/${i.type}` : ''}] ${i.message}`).join('\n')
      : '- (无 error 级问题)';

    // multi-artifact-batch:非 flowchart 形态的措辞与校验要点按形态替换(元素 ≠ 节点与边)
    const isArtifact = !!req.artifactKind && req.artifactKind !== 'flowchart';
    const ruleText = isArtifact
      ? `校验规则要点:按 ${req.artifactKind} 形态的结构契约修正(层级/行列/分组/时序等结构问题),保持该形态 JSON 字段不变。`
      : `校验规则要点:\n${REFLECT_SYSTEM_PROMPT}`;

    // 局部修正范围:只列出问题涉及的节点 id,其余部分明确要求原样保留
    const touchedIds = Array.from(new Set(blocking.flatMap((i) => i.nodeIds ?? [])));
    const scopeText = touchedIds.length
      ? `本次只需修正与这些${isArtifact ? '元素' : '节点/边'}相关的部分: ${touchedIds.join(', ')}。其余${
          isArtifact ? '元素' : '节点与边'
        }必须原样保留,不得重命名、不得重排 id、不得增删无关元素。`
      : `请只修正上述问题涉及的元素,其余${
          isArtifact ? '元素' : '节点与边'
        }必须原样保留,不得重命名、不得重排 id、不得增删无关元素。`;

    const canvasText = req.canvasSummary ? `当前画布:\n${req.canvasSummary}` : '';
    const draftText = req.draftSummary ? `当前草稿结构:\n${req.draftSummary}` : '';

    return [
      `【局部修正指令】上一次输出未通过确定性校验。这是第 N 次修正,请做最小改动修复问题,不要重写整个${
        isArtifact ? '产物' : '流程'
      }。`,
      '',
      ruleText,
      '',
      `未通过的校验问题:\n${issueText}`,
      '',
      scopeText,
      canvasText,
      draftText,
      '',
      `上一次输出:\n${req.rawOutput}`,
      '',
      '输出要求:只输出修正后的完整 JSON(不要 markdown、不要解释文字),结构字段与上一次保持一致。',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /**
   * 超限后的「人在回路」确认载荷(Task 9.2)
   * @param issues 未解决的 error 级问题
   * @param lastDraft 最后一次产出的结构(作为候选方案 1)
   * @param artifactKind multi-artifact-batch:非 flowchart 形态时,候选数据是产物本体,提示文案按形态调整
   */
  buildConfirmPayload(input: {
    intent: 'generate' | 'modify';
    issues: ReflectionIssue[];
    lastDraft?: unknown;
    lastOperations?: unknown;
    rewriteCount: number;
    maxRewrites: number;
    artifactKind?: ArtifactKind;
  }): HumanConfirmPayload {
    const blocking = (input.issues ?? []).filter((i) => (i.severity ?? 'error') === 'error');
    const data = input.intent === 'generate' ? input.lastDraft : input.lastOperations;
    const isArtifact = !!input.artifactKind && input.artifactKind !== 'flowchart';

    const candidates: HumanConfirmPayload['candidates'] = [];
    if (data) {
      candidates.push({
        id: 'accept-current',
        label: '采用当前版本',
        data,
        note: isArtifact
          ? `已自动修正 ${input.rewriteCount}/${input.maxRewrites} 次,仍存在 ${blocking.length} 个结构问题;采用后可基于当前版本继续对话调整。`
          : `已自动修正 ${input.rewriteCount}/${input.maxRewrites} 次,仍存在 ${blocking.length} 个结构问题;采用后可在画布上手动微调。`,
      });
    }
    candidates.push({
      id: 'retry-with-instruction',
      label: '补充约束后重新生成',
      note: '请用一句话补充约束(例如「决策节点必须有两个分支」「审批不通过要退回提交环节」),我会据此重跑生成。',
    });

    return {
      reason: `自动修正已达上限(${input.rewriteCount}/${input.maxRewrites}),仍有 ${blocking.length} 个结构问题无法自行解决,需要你确认后继续。${HUMAN_CONFIRM_FALLBACK_PROMPT}`,
      issues: blocking.map((i) => ({ layer: i.layer, type: i.type, message: i.message, nodeIds: i.nodeIds })),
      candidates,
    };
  }

  /** 工具重试耗尽后的受控降级话术(Task 8.3) */
  buildDegradeAnswer(reason?: string): string {
    return reason ? `${TOOL_DEGRADE_PROMPT}\n(原因摘要: ${reason})` : TOOL_DEGRADE_PROMPT;
  }
}
