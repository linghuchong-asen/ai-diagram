// 语图技术方案 - 校验工具(Task 8.6:接到 graph.validator.ts 真实实现)
// 职责:对模型产出的 FlowDraft 做「两层确定性校验」的薄封装,输出结构化问题列表,
//       供工具统一出口(ToolExecutor)归一化成 ToolResult,也供反思链路复用。
// 说明:旧的 FlowGraphSchema(start/task/gateway/end)是遗留契约,与当前 FlowDraft 契约
//       (start/end/process/decision/io/subprocess)不一致,故不再使用。
import { Injectable } from '@nestjs/common';
import { FlowDraft, FlowDraftSchema } from '../schemas/flow-draft.schema';
import { GraphIssue, GraphValidator } from '../reflection/graph.validator';

export interface GraphValidationToolResult {
  /** 是否通过 error 级校验(warning 级不阻断) */
  valid: boolean;
  /** 结构化问题列表(含 severity) */
  issues: GraphIssue[];
  /** 通过校验的 draft(格式非法时为 undefined) */
  draft?: FlowDraft;
}

@Injectable()
export class ValidatorTool {
  private readonly graphValidator = new GraphValidator();

  /** 校验任意输入:先 zod 格式,再图遍历结构 */
  validate(input: unknown): GraphValidationToolResult {
    const parsed = FlowDraftSchema.safeParse(input);
    if (!parsed.success) {
      return {
        valid: false,
        issues: [
          {
            type: 'INVALID_TYPE',
            severity: 'error',
            message: `FlowDraft 格式不合法: ${parsed.error.issues
              .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
              .join('; ')}`,
          },
        ],
      };
    }

    const structure = this.graphValidator.validate(parsed.data);
    return {
      // 仅 error 级问题阻断;warning(如合法回环)只提示
      valid: structure.issues.every((i) => i.severity === 'warning'),
      issues: structure.issues,
      draft: parsed.data,
    };
  }
}
