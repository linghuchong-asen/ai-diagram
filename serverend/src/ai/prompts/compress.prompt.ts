// apps/server/src/modules/ai/prompts/compress.prompt.ts
// 消费方:记忆模块(memory/summary + context/token-budget)—— 历史对话压缩摘要。
// 本编排链路(agents/graph.ts)不直接调用:generate / modify / consult 三条主链路的提示词
// 分别由 generate.prompt.ts / modify.prompt.ts / system.prompt.ts 提供,反思修正由 reflect.prompt.ts 提供。
import { PromptTemplate } from "@langchain/core/prompts";

export const compressPrompt = PromptTemplate.fromTemplate(`Summarize the chat history into a compact brief to preserve:
- Actors/roles
- Mandatory constraints
- Naming rules
- Open TODOs

Keep < 400 tokens. History:
{history}`);