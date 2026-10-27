// 语图技术方案 - 形式路由器单测(multi-artifact-batch Round 3)
// 覆盖四条关键路径:
//   ① formHint 显式指定 → 直通,零 LLM 调用;
//   ② 关键词规则 → 四形态样例零 token 命中;流程图信号独占时走 flowchart;
//   ③ 歧义(多形态并列)/全未命中 → LLM 兜底,带 usage;
//   ④ LLM 不可用 / 输出非法 / 超时 → 默认 flowchart,不抛出、不阻塞。
import { FormRouter, matchFormByRules, scoreFormKeywords, applySessionPreference } from './form.router';
import { LlmFactory } from '../adapters/llm.factory';
import { ArtifactKind } from '../schemas/artifact.schema';

/** 最小 fake:可配置可用性与 medium 模型返回 */
function fakeFactory(options: {
  available?: boolean;
  reply?: string;
  reject?: Error;
  spy?: { calls: number; lastPrompt?: string };
}) {
  return {
    isAvailable() {
      return options.available ?? true;
    },
    getModels() {
      return {
        medium: {
          async invoke(messages: any) {
            if (options.spy) {
              options.spy.calls += 1;
              options.spy.lastPrompt = messages?.[1]?.content;
            }
            if (options.reject) throw options.reject;
            return { content: options.reply ?? 'flowchart' };
          },
        },
      };
    },
  } as unknown as LlmFactory;
}

describe('形式路由器(multi-artifact-batch Round 3)', () => {
  // ---- ① formHint 直通 ----
  it('① formHint 显式指定时直通,不调规则打分后的 LLM', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ reply: 'timeline', spy }));
    const res = await router.route('帮我画个请假审批流程图', 'timeline');
    expect(res.kind).toBe('timeline');
    expect(res.source).toBe('hint');
    expect(res.llmAttempted).toBe(false);
    expect(spy.calls).toBe(0);
  });

  // ---- ② 关键词规则零 token 命中 ----
  it('② 四形态样例零 token 命中规则', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ spy }));
    const cases: Array<[string, ArtifactKind]> = [
      ['整理一下这次会议的待办清单', 'checklist'],
      ['帮我对比一下这三个技术方案的优缺点', 'table'],
      ['安排一下成都三天两晚的行程', 'timeline'],
      ['把这篇长文整理成思维导图', 'mindmap'],
    ];
    for (const [query, expected] of cases) {
      const res = await router.route(query);
      expect(res.kind).toBe(expected);
      expect(res.source).toBe('rule');
      expect(res.llmAttempted).toBe(false);
    }
    expect(spy.calls).toBe(0);
  });

  it('② 流程图信号独占时走 flowchart(不误路由到新形态)', async () => {
    const router = new FormRouter(fakeFactory({ reply: 'mindmap' }));
    const res = await router.route('帮我生成一个员工请假审批流程图,含驳回分支');
    expect(res.kind).toBe('flowchart');
    expect(res.source).toBe('rule');
  });

  it('② 规则打分:并列最高视为歧义返回 null(如「对比流程」)', () => {
    // 「对比」命中 table、「流程」命中 flowchart 信号 → 并列 → 歧义
    const ambiguous = matchFormByRules('对比一下这两个流程的差异');
    expect(ambiguous.kind).toBeNull();
    expect(ambiguous.reasons.some((r) => r.includes('并列'))).toBe(true);
  });

  // ---- ③ LLM 兜底 ----
  it('③ 歧义输入走 LLM 兜底并采信结果,附 token 用量', async () => {
    const spy: { calls: number; lastPrompt?: string } = { calls: 0 };
    const router = new FormRouter(
      fakeFactory({
        reply: 'table',
        spy,
      }),
    );
    const res = await router.route('对比一下这两个流程的差异');
    expect(res.kind).toBe('table');
    expect(res.source).toBe('llm');
    expect(res.llmAttempted).toBe(true);
    expect(spy.calls).toBe(1);
    // 兜底提示词应携带规则线索,帮助模型理解歧义点
    expect(spy.lastPrompt ?? '').toContain('规则线索');
  });

  it('③ 全未命中(无任何形态词)也走 LLM 兜底', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ reply: 'checklist', spy }));
    const res = await router.route('下周五之前我要把新办公室安顿好');
    expect(res.source).toBe('llm');
    expect(res.kind).toBe('checklist');
    expect(spy.calls).toBe(1);
  });

  // ---- ④ 失败兜底 ----
  it('④ LLM 输出非法(含多个形态词)时丢弃,默认 flowchart', async () => {
    const router = new FormRouter(fakeFactory({ reply: 'mindmap or table 都可以' }));
    const res = await router.route('对比一下这两个流程的差异');
    expect(res.kind).toBe('flowchart');
    expect(res.source).toBe('default');
    expect(res.llmAttempted).toBe(true);
  });

  it('④ LLM 不可用时直接默认 flowchart,不尝试调用', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ available: false, spy }));
    const res = await router.route('对比一下这两个流程的差异');
    expect(res.kind).toBe('flowchart');
    expect(res.source).toBe('default');
    expect(res.llmAttempted).toBe(false);
    expect(spy.calls).toBe(0);
  });

  it('④ LLM 抛错(网络)时捕获并默认 flowchart,不向上抛出', async () => {
    const router = new FormRouter(fakeFactory({ reject: new Error('network down') }));
    const res = await router.route('下周五之前我要把新办公室安顿好');
    expect(res.kind).toBe('flowchart');
    expect(res.source).toBe('default');
  });

  // ---- 纯函数打分的边界 ----
  it('打分纯函数:大小写不敏感,英文关键词(day1/vs)可命中', () => {
    const { scores } = scoreFormKeywords('帮我安排 Day1 和 DAY2 的行程');
    expect(scores.timeline).toBeGreaterThanOrEqual(3); // day1 + day2 + 行程
    const vs = scoreFormKeywords('React vs Vue 怎么选');
    expect((vs.scores.table ?? 0)).toBeGreaterThanOrEqual(2); // vs + 怎么选
  });

  it('打分纯函数:无信号时返回空结果', () => {
    const { scores, hitKeywords } = scoreFormKeywords('今天天气不错');
    expect(Object.keys(scores).length).toBe(0);
    expect(Object.keys(hitKeywords).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 会话形态偏好(competitor-driven-evolution-batch Round 15)
// ---------------------------------------------------------------------------
describe('会话形态偏好(Round 15)', () => {
  it('⑤ 偏好生效:规则歧义时,会话内 ≥2 次且严格最多的形态被直接采信(省一次 LLM 兜底)', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ reply: 'mindmap', spy }));
    // 「对比(→table) + 流程(→flowchart)」规则并列 → 歧义;会话内 table 已 2 次 → 采信 table
    const result = await router.route('对比一下这两个流程', undefined, { table: 2, checklist: 1 });
    expect(result.kind).toBe('table');
    expect(result.source).toBe('rule');
    expect(result.reasons.join(' ')).toContain('会话偏好');
    expect(result.llmAttempted).toBe(false);
    expect(spy.calls).toBe(0);
  });

  it('⑤ 偏好不覆盖 formHint:显式指定永远最高优先级', async () => {
    const router = new FormRouter(fakeFactory({}));
    const result = await router.route('随便描述一下', 'timeline', { table: 5 });
    expect(result.kind).toBe('timeline');
    expect(result.source).toBe('hint');
  });

  it('⑤ 偏好不覆盖规则:规则有唯一胜者时按规则走(偏好只在歧义/未命中时兜底)', async () => {
    const router = new FormRouter(fakeFactory({}));
    // 「时间线」规则唯一命中 timeline;会话内 table 偏好不生效
    const result = await router.route('帮我做一个旅行时间线', undefined, { table: 2 });
    expect(result.kind).toBe('timeline');
    expect(result.source).toBe('rule');
    expect(result.reasons.join(' ')).not.toContain('会话偏好');
  });

  it('⑤ 并列最多 / 计数不足阈值 → 忽略偏好,仍走 LLM 兜底', async () => {
    const spy = { calls: 0 };
    const router = new FormRouter(fakeFactory({ reply: 'checklist', spy }));
    const tied = await router.route('对比一下这两个流程', undefined, { table: 2, timeline: 2 });
    expect(tied.source).toBe('llm');
    expect(tied.kind).toBe('checklist');
    const weak = await router.route('对比一下这两个流程', undefined, { table: 1 });
    expect(weak.source).toBe('llm');
    expect(spy.calls).toBe(2); // 两次都消耗了 LLM 兜底
  });

  it('⑤ applySessionPreference 纯函数:缺省/全零 → null;严格最多且 ≥2 → 采信', () => {
    expect(applySessionPreference(undefined).kind).toBeNull();
    expect(applySessionPreference({}).kind).toBeNull();
    expect(applySessionPreference({ table: 0 }).kind).toBeNull();
    expect(applySessionPreference({ table: 2, mindmap: 1 }).kind).toBe('table');
    expect(applySessionPreference({ table: 2, mindmap: 2 }).kind).toBeNull();
  });
});
