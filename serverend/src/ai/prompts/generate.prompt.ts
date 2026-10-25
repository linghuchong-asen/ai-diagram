// 语图技术方案 - generate 场景提示词(大模型生成)
// 由 agents/graph.ts 的 callLlm 消费(Task 9.3):统一从这里出消息数组,不再在编排层手拼 role。
import { hasEmbeddedSystemPrompt, SYSTEM_PROMPT } from './system.prompt';

export function buildGeneratePrompt(input: {
  context: string; // 已组装好的上下文(system + question + schema 引导 + history)
}): Array<{ role: 'system' | 'user'; content: string }> {
  // ContextBuilder 已把【系统指令】拼在上下文开头时不再重复注入,避免挤占 token 预算
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (!hasEmbeddedSystemPrompt(input.context)) {
    messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: input.context });
  return messages;
}
