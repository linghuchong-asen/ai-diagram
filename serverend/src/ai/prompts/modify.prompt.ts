// 语图技术方案 - modify 场景提示词(大模型生成操作序列)
// 由 agents/graph.ts 的 callLlm 消费(Task 9.3):统一从这里出消息数组,不再在编排层手拼 role。
import { hasEmbeddedSystemPrompt, SYSTEM_PROMPT } from './system.prompt';

export function buildModifyPrompt(input: {
  context: string; // 含画布语义摘要 + schema 引导 + 历史
}): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (!hasEmbeddedSystemPrompt(input.context)) {
    messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: input.context });
  return messages;
}
