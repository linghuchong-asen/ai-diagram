// apps/server/src/modules/ai/prompts/suggest.prompt.ts
// 消费方:上下文模块(context)—— 生成「追问建议」,属交互增强能力,
// 不由 agents/graph.ts 的 generate/modify/consult 主链路调用(Task 9.3 说明)。
import { PromptTemplate } from "@langchain/core/prompts";

export const suggestPrompt = PromptTemplate.fromTemplate(`Given the user's latest intent:
"{input}"

And the current graph summary:
"{graphSummary}"

Propose 3-5 short follow-up questions (<=16 chars). Return a JSON array of strings.`);