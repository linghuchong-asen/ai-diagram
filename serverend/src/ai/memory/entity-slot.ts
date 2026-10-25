// 语图技术方案 - sessionEntitySlot 实体保真槽(Task 10.5)
// 文档(memory.md):"分离存储、混合检索,压缩叙事不压缩事实"。
//   滚动摘要会丢失精确实体(角色名、节点名、硬性约束、命名规则),
//   因此把这类"事实"单独放进 sessionEntitySlot,注入上下文时独立成段且不参与截断。
import { Injectable } from '@nestjs/common';

export interface SessionEntities {
  sessionId: string;
  /** 角色/参与者(如"部门经理""财务") */
  actors: string[];
  /** 命名规则与专有名词(如节点名、字段名) */
  names: string[];
  /** 硬性约束(如"审批不通过必须退回提交环节") */
  constraints: string[];
  /** 未完成事项 TODO */
  todos: string[];
  updatedAt: number;
}

/** 每个槽位最多保留的条目数(实体槽很小,超限丢弃最旧的) */
const MAX_ITEMS_PER_SLOT = 12;
/** 单条实体最大长度 */
const MAX_ITEM_LEN = 120;
/** 进程内追踪的会话槽上限(超限按 LRU 淘汰最久未访问项,防 Map 无界增长) */
const MAX_TRACKED_SESSIONS = 5000;

/** 从文本中抽取实体的轻量规则(无额外依赖):
 *  - 角色:出现在「XX审批 / XX确认 / 提交人 / 负责人 / 经理 / 主管」等模式的中文名词
 *  - 约束:含「必须/不得/禁止/只能/需要/要求」的句子
 *  - 命名:引号内(""/''/「」)或反引号内的短词
 *  - TODO:含「待/暂不/后续/TODO」的句子
 */
export function extractEntities(text: string): {
  actors: string[];
  names: string[];
  constraints: string[];
  todos: string[];
} {
  const source = text ?? '';
  const actors = new Set<string>();
  const names = new Set<string>();
  const constraints = new Set<string>();
  const todos = new Set<string>();

  for (const m of source.matchAll(/[\u4e00-\u9fa5A-Za-z]{2,8}?(?=审批|审核|确认|复核|签署|驳回)/g)) {
    const v = m[0]?.trim();
    if (v && v.length >= 2) actors.add(v);
  }
  for (const m of source.matchAll(/(提交人|申请人|负责人|经办人|部门经理|主管|财务|人事|管理员)/g)) {
    actors.add(m[1]);
  }

  for (const m of source.matchAll(/[「『"'`]([^「」『』"'`\n]{1,24})[」』"'`]/g)) {
    const v = m[1]?.trim();
    if (v) names.add(v);
  }

  for (const sentence of splitSentences(source)) {
    if (/(必须|不得|禁止|只能|不允许|要求|需要严格)/.test(sentence)) constraints.add(sentence);
    if (/(待确认|待定|暂不|后续|TODO|未完成)/i.test(sentence)) todos.add(sentence);
  }

  return {
    actors: cap([...actors]),
    names: cap([...names]),
    constraints: cap([...constraints]),
    todos: cap([...todos]),
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n。;;!?!?]+/)
    .map((s) => s.trim().slice(0, MAX_ITEM_LEN))
    .filter((s) => s.length >= 4);
}

function cap(items: string[]): string[] {
  return items.slice(-MAX_ITEMS_PER_SLOT).map((i) => i.slice(0, MAX_ITEM_LEN));
}

@Injectable()
export class SessionEntitySlotService {
  private slots = new Map<string, SessionEntities>();

  /** 读取会话实体槽(LRU:读取即刷新到队尾) */
  get(sessionId: string): SessionEntities | null {
    if (!sessionId) return null;
    const slot = this.slots.get(sessionId);
    if (!slot) return null;
    this.slots.delete(sessionId);
    this.slots.set(sessionId, slot);
    return slot;
  }

  /** 从一轮对话中抽取并合并实体(去重,超限丢弃最旧) */
  ingest(sessionId: string, text: string): SessionEntities | null {
    if (!sessionId || !text?.trim()) return null;
    const extracted = extractEntities(text);
    const prev = this.slots.get(sessionId) ?? emptySlot(sessionId);

    const merged: SessionEntities = {
      sessionId,
      actors: mergeItems(prev.actors, extracted.actors),
      names: mergeItems(prev.names, extracted.names),
      constraints: mergeItems(prev.constraints, extracted.constraints),
      todos: mergeItems(prev.todos, extracted.todos),
      updatedAt: Date.now(),
    };
    // Map 保持插入序:先删再插实现 LRU,超限淘汰最前面的(最久未访问)
    this.slots.delete(sessionId);
    this.slots.set(sessionId, merged);
    while (this.slots.size > MAX_TRACKED_SESSIONS) {
      const oldestKey = this.slots.keys().next().value;
      if (oldestKey === undefined) break;
      this.slots.delete(oldestKey);
    }
    return merged;
  }

  /** 渲染为上下文片段(实体保真段:不参与截断) */
  render(sessionId: string): string {
    const slot = this.get(sessionId);
    if (!slot) return '';
    const lines: string[] = [];
    if (slot.actors.length) lines.push(`- 角色: ${slot.actors.join('、')}`);
    if (slot.names.length) lines.push(`- 命名/专有名词: ${slot.names.join('、')}`);
    if (slot.constraints.length) lines.push(`- 硬性约束:\n${slot.constraints.map((c) => `  * ${c}`).join('\n')}`);
    if (slot.todos.length) lines.push(`- 待办:\n${slot.todos.map((c) => `  * ${c}`).join('\n')}`);
    if (lines.length === 0) return '';
    return `【会话事实(不可改写)】\n${lines.join('\n')}`;
  }

  clear(sessionId: string): void {
    this.slots.delete(sessionId);
  }
}

function emptySlot(sessionId: string): SessionEntities {
  return { sessionId, actors: [], names: [], constraints: [], todos: [], updatedAt: Date.now() };
}

function mergeItems(prev: string[], next: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...prev, ...next]) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, MAX_ITEM_LEN));
  }
  return out.slice(-MAX_ITEMS_PER_SLOT);
}
