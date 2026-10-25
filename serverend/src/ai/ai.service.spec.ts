// 语图商业化首发 - 免登录单次试用单测(Task 3)+ generate 埋点单测(Task 4)
// 模式:纯逻辑直测 + jest.fn mock 依赖,不起 Nest TestingModule(与 project_share.service.spec 同款)
import { HttpException } from '@nestjs/common';
import { AiService } from './ai.service';
import { TrialChatRequestSchema } from './schemas/chat.schema';

/** 依赖桩:AiService 只用到下列方法,graph.run 返回可定制的终态 state */
function makeService(env: Record<string, string> = {}, state: Record<string, unknown> = {}) {
  const graph = { run: jest.fn(async () => ({ state: { ...state } })) };
  const threadStore = { create: jest.fn(), setResult: jest.fn(), setError: jest.fn() };
  const thinkStream = { publish: jest.fn(), end: jest.fn(), error: jest.fn() };
  const toolExecutor = { releaseThread: jest.fn() };
  const checkpoints = { get: jest.fn(async () => null) };
  const longTermMemory = { add: jest.fn(async () => undefined) };
  const profiles = { ingestFromConversation: jest.fn(async () => undefined) };
  const quota = {
    assertCanRun: jest.fn(async () => ({})),
    consume: jest.fn(async () => undefined),
    addSessionUsage: jest.fn(() => ({ sessionTokens: 0 })),
  };
  const growthEvent = { track: jest.fn() };
  const config = { get: (key: string) => env[key] };
  const service = new AiService(
    graph as never,
    threadStore as never,
    thinkStream as never,
    toolExecutor as never,
    checkpoints as never,
    longTermMemory as never,
    profiles as never,
    quota as never,
    config as never,
    growthEvent as never,
  );
  return { service, graph, threadStore, thinkStream, toolExecutor, quota, growthEvent };
}

/** 等待后台 executeGraph(异步 void)收敛:链路全为微任务,一个宏任务边界足够 */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 断言 429 + 错误码契约(前端依赖精确匹配) */
async function expectTrialReject(promise: Promise<unknown>, code: string, message: string) {
  await expect(promise).rejects.toThrow(HttpException);
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code, message });
  }
}

describe('startTrial（Task 3 免登录单次试用）', () => {
  it('首次通过 → 返回 threadId 并以强制 generate 意图建线程,不扣用户配额', async () => {
    const { service, graph, threadStore, quota } = makeService();
    const result = await service.startTrial({ message: '画一个请假流程', trialId: 't1' }, '1.1.1.1');
    expect(result.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(threadStore.create).toHaveBeenCalledWith(result.threadId);
    expect(quota.assertCanRun).not.toHaveBeenCalled(); // 匿名不扣用户配额
    expect(graph.run).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'generate', trialId: 't1', sessionId: 'trial:t1' }),
      expect.anything(),
    );
  });

  it('同一 trialId 当日第二次 → 429 TRIAL_USED', async () => {
    const { service } = makeService();
    await service.startTrial({ message: '第一次', trialId: 't1' }, '1.1.1.1');
    await expectTrialReject(
      service.startTrial({ message: '第二次', trialId: 't1' }, '1.1.1.1'),
      'TRIAL_USED',
      '试用次数已用完，注册后每日可生成 3 次',
    );
  });

  it('同 IP 第 4 次（换 trialId 也拦）→ 429 TRIAL_BUSY', async () => {
    const { service } = makeService();
    await service.startTrial({ message: 'm', trialId: 't1' }, '2.2.2.2');
    await service.startTrial({ message: 'm', trialId: 't2' }, '2.2.2.2');
    await service.startTrial({ message: 'm', trialId: 't3' }, '2.2.2.2');
    await expectTrialReject(
      service.startTrial({ message: 'm', trialId: 't4' }, '2.2.2.2'),
      'TRIAL_BUSY',
      '今日试用名额已满，注册立即可用',
    );
  });

  it('全局日上限（AI_TRIAL_DAILY_GLOBAL_LIMIT=2）→ 第 3 次 429 TRIAL_BUSY', async () => {
    const { service } = makeService({ AI_TRIAL_DAILY_GLOBAL_LIMIT: '2' });
    await service.startTrial({ message: 'm', trialId: 'a' }, '3.3.3.1');
    await service.startTrial({ message: 'm', trialId: 'b' }, '3.3.3.2');
    await expectTrialReject(
      service.startTrial({ message: 'm', trialId: 'c' }, '3.3.3.3'),
      'TRIAL_BUSY',
      '今日试用名额已满，注册立即可用',
    );
  });

  it('全局限额未配置 → 默认 100 生效(第 100 次过、第 101 次拒)', async () => {
    const { service } = makeService();
    for (let i = 0; i < 100; i++) {
      // 单 IP 上限 3 → 每次换 IP;单 trialId 单次 → 每次换 trialId
      await service.startTrial({ message: 'm', trialId: `t${i}` }, `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`);
    }
    await expectTrialReject(
      service.startTrial({ message: 'm', trialId: 't100' }, '10.1.0.1'),
      'TRIAL_BUSY',
      '今日试用名额已满，注册立即可用',
    );
  });
});

describe('generate 增长埋点（Task 4,executeGraph 完成回传点）', () => {
  it('匿名试用生成完成 → track("generate",{anon:true,trialId,...,mode:"real"})', async () => {
    const { service, growthEvent } = makeService(
      {},
      {
        userId: undefined,
        intent: 'generate',
        trialId: 't-anon',
        sessionId: 'trial:t-anon',
        rawOutput: '画好了',
        result: { kind: 'generate' },
      },
    );
    await service.startTrial({ message: '画一个请假流程', trialId: 't-anon' }, '4.4.4.4');
    await flush();
    expect(growthEvent.track).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({
        userId: null,
        anon: true,
        trialId: 't-anon',
        intent: 'generate',
        mode: 'real',
        tokens: expect.any(Number),
      }),
    );
  });

  it('模板命中短路 → mode:"template",tokens 记 0(不耗 LLM)', async () => {
    const { service, growthEvent } = makeService(
      {},
      {
        userId: undefined,
        intent: 'generate',
        trialId: 't-tpl',
        sessionId: 'trial:t-tpl',
        templateMatched: true,
        result: { kind: 'generate' },
      },
    );
    await service.startTrial({ message: '请假流程', trialId: 't-tpl' }, '5.5.5.5');
    await flush();
    expect(growthEvent.track).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({ mode: 'template', tokens: 0, anon: true }),
    );
  });

  it('已登录生成完成 → anon:false、带 userId,并照常计量配额', async () => {
    const { service, growthEvent, quota } = makeService(
      {},
      {
        userId: 'u1',
        intent: 'generate',
        sessionId: 's1',
        rawOutput: '结果内容',
        result: { kind: 'generate' },
      },
    );
    await service.createThread({ userId: 'u1', message: '画一个报销流程' });
    await flush();
    expect(quota.consume).toHaveBeenCalledWith('u1', 'generate', expect.any(Number));
    expect(growthEvent.track).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({ userId: 'u1', anon: false, mode: 'real' }),
    );
  });

  it('consult/失败/挂起 不记 generate 埋点(只统计有效生成)', async () => {
    const { service, growthEvent } = makeService(
      {},
      { userId: 'u1', intent: 'consult', sessionId: 's', result: { kind: 'consult' } },
    );
    await service.createThread({ userId: 'u1', message: '咨询一下' });
    await flush();
    expect(growthEvent.track).not.toHaveBeenCalled();
  });
});

describe('TrialChatRequestSchema（入参校验,controller 400 依据）', () => {
  it('合法入参通过:message 非空 ≤500 字,trialId 非空 ≤64 字', () => {
    expect(
      TrialChatRequestSchema.safeParse({ message: '画一个请假流程', trialId: 't-1' }).success,
    ).toBe(true);
    expect(
      TrialChatRequestSchema.safeParse({ message: 'a'.repeat(500), trialId: 't'.repeat(64) }).success,
    ).toBe(true);
  });

  it('message 缺失/为空/超 500 字 → 拒绝(400)', () => {
    expect(TrialChatRequestSchema.safeParse({ trialId: 't' }).success).toBe(false);
    expect(TrialChatRequestSchema.safeParse({ message: '', trialId: 't' }).success).toBe(false);
    expect(TrialChatRequestSchema.safeParse({ message: 'a'.repeat(501), trialId: 't' }).success).toBe(false);
  });

  it('trialId 缺失/为空/超 64 字 → 拒绝(400)', () => {
    expect(TrialChatRequestSchema.safeParse({ message: 'x' }).success).toBe(false);
    expect(TrialChatRequestSchema.safeParse({ message: 'x', trialId: '' }).success).toBe(false);
    expect(TrialChatRequestSchema.safeParse({ message: 'x', trialId: 't'.repeat(65) }).success).toBe(false);
  });
});
