// 语图技术方案 - 受控降级话术(Task 8.3 / 9.2)
// 目的:工具重试耗尽、反思修正超限时,不让模型「自由发挥编造结果」,
//       而是使用这里固定的措辞,保证用户看到一致的、可预期的失败说明。
// 注意:这些是常量模板,不含用户数据,可直接返回给前端。

/** 工具重试耗尽后的降级话术(直接返回给用户,不再进模型) */
export const TOOL_DEGRADE_PROMPT = `本次流程生成所依赖的内部工具暂时不可用,我已停止自动重试。
为了不影响你的使用,请直接补充一句更具体的描述(例如「画一个三级审批的请假流程」),我会重新生成;
若仍失败,可先手动在画布上拖拽节点,我可以基于已有画布继续帮你调整。`;

/** 工具参数错误时回传给模型的自修正提示(结构化摘要,最多 3 次) */
export const PARAM_CORRECTION_HINT = `【工具参数错误】上一次的参数未通过 schema 校验。
请严格按下述要求重新给出参数,不要输出任何解释文字:
- 只使用被允许的字段名,不要臆造字段;
- 字符串字段不得为空;
- 若无法确定某个字段,宁可省略该字段(可选字段)也不要编造。`;

/** 反思修正超限后转「人在回路」的固定说明 */
export const HUMAN_CONFIRM_FALLBACK_PROMPT = `我已经尝试自动修正流程结构,但仍有校验问题无法自行解决,需要你确认后再继续。
你可以选择:
1) 采用当前最好的版本(可能仍存在提示中的结构问题);
2) 用一句话补充约束后让我重新生成(例如「决策节点必须有两个分支」)。`;

/** 意图识别失败时的兜底话术(极少触发:规则与模型都不可用) */
export const INTENT_FALLBACK_PROMPT = `我暂时无法确定你的意图,请明确一下是要:
1) 生成一张新的流程图;
2) 修改当前画布;
3) 咨询流程相关问题。`;

/** 通用未知错误话术(不暴露内部细节) */
export const GENERIC_ERROR_PROMPT = `本次请求处理失败,内部错误细节已做脱敏处理。请稍后重试,或换一种说法描述你的需求。`;

/**
 * 组装「工具降级」提示词:把脱敏后的失败摘要与固定话术拼接,供上层写入 result/思考流。
 * @param toolName 工具名
 * @param sanitizedReason 已脱敏的失败原因(来自 error-sanitizer)
 */
export function buildToolDegradeMessage(toolName: string, sanitizedReason: string): string {
  return `${TOOL_DEGRADE_PROMPT}\n(工具 ${toolName} 失败原因摘要: ${sanitizedReason})`;
}

/** 组装「人在回路」确认提示词 */
export function buildHumanConfirmMessage(reason: string): string {
  return `${HUMAN_CONFIRM_FALLBACK_PROMPT}\n(待确认原因: ${reason})`;
}
