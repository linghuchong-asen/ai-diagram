// 语图技术方案 - 反思:两层确定性校验器
// 文档:① Zod Schema 格式合法 → ② 图遍历结构合理
// 失败 → 附失败原因走 Rewriter 局部修正(不重走完整主流程)
// multi-artifact-batch:generate 分支按 artifactKind 扩展——flowchart 走既有 FlowDraft+GraphValidator,
// 四新形态走各形态 Schema + artifact.validator 结构遍历(同一 error/warning 分级语义)。
import { Injectable, Logger } from '@nestjs/common';
import { FlowDraftSchema, FlowDraft } from '../schemas/flow-draft.schema';
import { ModifyPatchOutputSchema, ModifyPatchOutput } from '../schemas/patch.schema';
import { GraphValidator, GraphValidationResult } from './graph.validator';
import { artifactSchemaFor } from '../schemas/artifact.schema';
import { validateArtifact, NewArtifactKind } from './artifact.validator';

export type ReflectionSubject =
  | { kind: 'generate'; draft: FlowDraft }
  | { kind: 'modify'; patch: ModifyPatchOutput }
  /** 多形态产物(multi-artifact-batch):data 已通过对应形态 Zod 层后再进入此处 */
  | { kind: 'artifact'; artifactKind: NewArtifactKind; data: unknown };

export interface ReflectionIssue {
  layer: 'format' | 'structure';
  message: string;
  /**
   * 问题级别(Task 9.1):
   *  - error  :阻断产出,必须走 Rewriter 局部修正;
   *  - warning:不阻断(如合法回环 HAS_CYCLE),仅作为提示随结果透出。
   * 默认 error。
   */
  severity?: 'error' | 'warning';
  /** 问题涉及的节点 id(用于 Rewriter「只改相关部分」的局部修正) */
  nodeIds?: string[];
  /** 结构问题类型(如 HAS_CYCLE / DECISION_NO_BRANCH),便于上层做差异化提示 */
  type?: string;
}

export interface ReflectionResult {
  /** 无 error 级问题即为 true(warning 不影响 valid) */
  valid: boolean;
  issues: ReflectionIssue[];
  /** 仅 error 级问题(Rewriter 只针对这些做修正) */
  blockingIssues: ReflectionIssue[];
  /** 仅 warning 级问题(透出给用户/日志,不进修正提示) */
  warnings: ReflectionIssue[];
  structure: GraphValidationResult | null;
}

@Injectable()
export class ReflectionEvaluator {
  private readonly logger = new Logger(ReflectionEvaluator.name);
  private readonly graphValidator = new GraphValidator();

  /** 对生成结果执行两层校验 */
  evaluate(subject: ReflectionSubject): ReflectionResult {
    const issues: ReflectionIssue[] = [];
    let structure: GraphValidationResult | null = null;

    // 第一层:Zod Schema 格式校验(字段级语义约束)
    if (subject.kind === 'generate') {
      const parsed = FlowDraftSchema.safeParse(subject.draft);
      if (!parsed.success) {
        issues.push({
          layer: 'format',
          severity: 'error',
          message: `FlowDraft 格式不合法: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        });
      }
    } else if (subject.kind === 'artifact') {
      // 多形态:按形态取对应 Schema 校验(flowchart 不进入此分支,artifactSchemaFor 对其返回 null 属防御兜底)
      const schema = artifactSchemaFor(subject.artifactKind);
      const parsed = schema ? schema.safeParse(subject.data) : null;
      if (parsed && !parsed.success) {
        issues.push({
          layer: 'format',
          severity: 'error',
          message: `${subject.artifactKind} 产物格式不合法: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        });
      }
    } else {
      const parsed = ModifyPatchOutputSchema.safeParse(subject.patch);
      if (!parsed.success) {
        issues.push({
          layer: 'format',
          severity: 'error',
          message: `ModifyPatchOutput 格式不合法: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        });
      }
    }

    // 第二层:图遍历结构校验(仅 generate 场景需要);多形态走 artifact.validator
    if (subject.kind === 'generate') {
      structure = this.graphValidator.validate(subject.draft);
      // warning 级(如 HAS_CYCLE 合法回环)也收进 issues 供透出,但不阻断
      for (const i of structure.issues) {
        issues.push({
          layer: 'structure',
          severity: i.severity ?? 'error',
          message: i.message,
          nodeIds: i.detail ?? (i.nodeId ? [i.nodeId] : undefined),
          type: i.type,
        });
      }
    } else if (subject.kind === 'artifact') {
      // 格式层失败(issues 已有 format error)时跳过结构遍历,避免对脏数据二次报错淹没根因
      if (!issues.some((i) => i.layer === 'format')) {
        issues.push(...validateArtifact({ kind: subject.artifactKind, data: subject.data }).issues);
      }
    }

    const blockingIssues = issues.filter((i) => (i.severity ?? 'error') === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const valid = blockingIssues.length === 0;

    this.logger.debug(
      `反思结果: valid=${valid}, blocking=${blockingIssues.length}, warning=${warnings.length}, issues=${JSON.stringify(
        issues,
      )}`,
    );
    return { valid, issues, blockingIssues, warnings, structure };
  }
}
