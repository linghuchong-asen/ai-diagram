// 语图技术方案 - 工具统一出口单测(Task 8.4)
// 覆盖:白名单拒绝 / param 不重试 / network 指数退避 / 重试耗尽降级 / 结果封顶
import { ToolExecutor, capResult } from './tool-executor';
import { ToolRegistry, ToolExecutionResult } from './tool.registry';
import { ToolContextStore } from './tool-context.store';
import { TOOL_RESULT_MAX_STRING_LEN, TOOL_RESULT_TOP_K } from './tool.types';

/** 构造假的 Registry:has 控制白名单,execute 按脚本顺序返回 */
function fakeRegistry(script: ToolExecutionResult[], whitelist: string[] = ['template_match']) {
  const calls: Array<{ name: string; params: unknown }> = [];
  const registry = {
    get whitelist() {
      return whitelist;
    },
    has: (name: string) => whitelist.includes(name),
    execute: async (call: { name: string; params: Record<string, unknown> }) => {
      calls.push({ name: call.name, params: call.params });
      const idx = Math.min(calls.length - 1, script.length - 1);
      return script[idx];
    },
  };
  return { registry: registry as unknown as ToolRegistry, calls };
}

/** 不真正等待的 sleep:只记录退避时长 */
function recordingSleep() {
  const delays: number[] = [];
  return { sleep: async (ms: number) => void delays.push(ms), delays };
}

describe('ToolExecutor', () => {
  it('白名单外的工具直接拒绝,不会触达 Registry', async () => {
    const { registry, calls } = fakeRegistry([]);
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'delete_all', params: {} });

    expect(result.status).toBe('fail');
    expect(result.error_type).toBe('fail');
    expect(result.message_for_llm).toContain('不在可用白名单内');
    expect(calls).toHaveLength(0);
  });

  it('参数错误(param)不做代码层重试,回传结构化摘要供模型自修正', async () => {
    const { registry, calls } = fakeRegistry([
      {
        name: 'template_match',
        ok: false,
        error: {
          status: 'error',
          error_type: 'param',
          message_for_llm: '工具 template_match 参数不合法: query 不能为空',
          suggestion: 'model-correct',
        },
      },
    ]);
    const { sleep, delays } = recordingSleep();
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'template_match', params: {}, sleep });

    expect(result.status).toBe('fail');
    expect(result.error_type).toBe('param');
    expect(result.message_for_llm).toContain('工具参数错误');
    expect(result.message_for_llm).toContain('query 不能为空');
    expect(calls).toHaveLength(1); // 只调用一次
    expect(delays).toHaveLength(0); // 不退避
  });

  it('网络错误按 200/400 指数退避后重试成功', async () => {
    const networkError: ToolExecutionResult = {
      name: 'template_match',
      ok: false,
      error: { status: 'error', error_type: 'network', message_for_llm: '网络错误', suggestion: 'code-retry' },
    };
    const { registry, calls } = fakeRegistry([
      networkError,
      networkError,
      { name: 'template_match', ok: true, data: { matched: false } },
    ]);
    const { sleep, delays } = recordingSleep();
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'template_match', params: { query: '画个流程' }, sleep });

    expect(result.status).toBe('ok');
    expect(delays).toEqual([200, 400]);
    expect(calls).toHaveLength(3);
    expect(result.message_for_llm).toContain('未命中内置模板');
  });

  it('网络错误重试耗尽后返回受控降级话术(不含原始堆栈)', async () => {
    const { registry, calls } = fakeRegistry([
      {
        name: 'template_match',
        ok: false,
        error: { status: 'error', error_type: 'network', message_for_llm: '连接 10.12.33.44 超时', suggestion: 'code-retry' },
      },
    ]);
    const { sleep, delays } = recordingSleep();
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'template_match', params: { query: 'x' }, sleep });

    expect(result.status).toBe('fail');
    expect(result.error_type).toBe('network');
    expect(result.message_for_llm).toContain('内部工具暂时不可用');
    expect(result.message_for_llm).not.toContain('10.12.33.44');
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([200, 400]);
  });

  it('fail 类错误不重试,直接降级', async () => {
    const { registry, calls } = fakeRegistry([
      {
        name: 'template_match',
        ok: false,
        error: { status: 'error', error_type: 'fail', message_for_llm: '模板库不可用', suggestion: 'fallback' },
      },
    ]);
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'template_match', params: { query: 'x' } });

    expect(result.status).toBe('fail');
    expect(calls).toHaveLength(1);
  });

  it('成功结果写入 contextId 并可通过 ToolContextStore 追回', async () => {
    const store = new ToolContextStore();
    const { registry } = fakeRegistry([
      { name: 'template_match', ok: true, data: { matched: true, templateId: 'leave-approval', templateName: '请假审批流程', draft: { nodes: [], edges: [] } } },
    ]);
    const executor = new ToolExecutor(registry, store);

    const result = await executor.execute({
      name: 'template_match',
      params: { query: '请假流程' },
      threadId: 'thread-1',
      contextId: 'ctx-fixed',
    });

    expect(result.status).toBe('ok');
    expect(result.contextId).toBe('ctx-fixed');
    expect(result.usage).toEqual({ calls: 1 });
    expect(store.get('ctx-fixed')?.payload).toMatchObject({ templateId: 'leave-approval' });

    executor.releaseThread('thread-1');
    expect(store.size).toBe(0);
  });

  it('成功结果按字段白名单裁剪(未登记字段不下发给模型)', async () => {
    const { registry } = fakeRegistry([
      {
        name: 'template_match',
        ok: true,
        data: { matched: true, templateId: 'a', templateName: 'b', draft: {}, secretField: 'sk-abcdefgh12345678' },
      },
    ]);
    const executor = new ToolExecutor(registry, new ToolContextStore());

    const result = await executor.execute({ name: 'template_match', params: { query: 'x' } });

    expect(result.data).not.toHaveProperty('secretField');
    expect(JSON.stringify(result.data)).not.toContain('sk-abcdefgh');
  });
});

describe('capResult 结果封顶', () => {
  it('数组只保留前 5 项并附截断说明', () => {
    const capped = capResult(Array.from({ length: 12 }, (_, i) => i)) as unknown[];
    expect(capped).toHaveLength(TOOL_RESULT_TOP_K + 1);
    expect(String(capped[capped.length - 1])).toContain('共 12 项');
  });

  it('超长字符串截断并注明截断长度', () => {
    const long = 'x'.repeat(TOOL_RESULT_MAX_STRING_LEN + 300);
    const capped = capResult(long) as string;
    expect(capped.length).toBeLessThan(long.length);
    expect(capped).toContain(`truncated 300 chars`);
  });

  it('嵌套深度超限时以占位符收口', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const capped = capResult(deep) as any;
    expect(JSON.stringify(capped)).toContain('depth-limited');
  });

  it('按工具白名单过滤对象字段', () => {
    const capped = capResult({ valid: true, issues: [], extra: 1 }, 'validate_graph') as any;
    expect(Object.keys(capped).sort()).toEqual(['issues', 'valid']);
  });
});
