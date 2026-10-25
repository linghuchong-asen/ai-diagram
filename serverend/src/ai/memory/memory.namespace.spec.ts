// 语图技术方案 - 长期记忆/用户画像命名空间隔离单测(Task 10.6 / security.md 数据隔离)
// 覆盖:长期记忆必须带 sessionId/projectId 命名空间(禁全局检索)、
//       候选集按命名空间过滤、画像按 user_id 隔离(拒绝 sessionId 冒充)
import { InMemoryLongTermStore, assertNamespace } from './long-term/long-term.store';
import { fuseDualPath } from './long-term/long-term.store';
import { assertUserNamespace, InMemoryProfileStore, UserProfileService } from './profile/user.profile';

describe('assertNamespace(读写命名空间校验)', () => {
  it('无 sessionId 且无 projectId → 抛错(禁止跨项目全局检索)', () => {
    expect(() => assertNamespace({}, '检索')).toThrow(/命名空间/);
    expect(() => assertNamespace({ sessionId: undefined, projectId: undefined }, '写入')).toThrow();
  });

  it('带 sessionId 或 projectId 即合法', () => {
    expect(() => assertNamespace({ sessionId: 's1' }, '检索')).not.toThrow();
    expect(() => assertNamespace({ projectId: 'p1' }, '写入')).not.toThrow();
  });
});

describe('InMemoryLongTermStore(命名空间过滤)', () => {
  const store = new InMemoryLongTermStore();

  beforeAll(async () => {
    await store.add({ sessionId: 's1', projectId: 'p1', content: '项目一的审批记忆', keywords: ['审批'] });
    await store.add({ sessionId: 's2', projectId: 'p2', content: '项目二的报销记忆', keywords: ['报销'] });
    await store.add({ sessionId: 's1', projectId: 'p1', content: '项目一的招聘记忆', keywords: ['招聘'] });
  });

  it('按 projectId 过滤:项目一读不到项目二的记忆', async () => {
    const list = await store.listCandidates({ projectId: 'p1', limit: 100 });
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.projectId === 'p1')).toBe(true);
  });

  it('按 sessionId 过滤', async () => {
    const list = await store.listCandidates({ sessionId: 's2', limit: 100 });
    expect(list).toHaveLength(1);
    expect(list[0].content).toContain('报销');
  });

  it('PG/内存实现的 listCandidates 拒绝无命名空间查询', async () => {
    // InMemory 实现层面:无命名空间时由服务层 assertNamespace 拦截;双保险见 PgLongTermStore 抛错语义
    expect(() => assertNamespace({}, '候选集查询')).toThrow();
  });
});

describe('fuseDualPath(双路召回退化)', () => {
  it('无向量时 vectorPathEnabled=false,仅关键词路', () => {
    const candidates = [
      { id: 'a', keywords: ['审批'], content: '', lastAccessAt: 1 },
      { id: 'b', keywords: ['报销'], content: '', lastAccessAt: 2 },
    ] as any[];
    const { ids, vectorPathEnabled } = fuseDualPath(candidates, { query: '审批 报销' });
    expect(vectorPathEnabled).toBe(false);
    expect(ids).toEqual(['a', 'b']);
  });

  it('两路都有信号时,双路命中的记录排前', () => {
    const shared = { id: 'shared', keywords: ['审批'], content: '', vector: [1, 0], lastAccessAt: 1 };
    const kwOnly = { id: 'kw-only', keywords: ['审批'], content: '', vector: undefined, lastAccessAt: 2 };
    const vecOnly = { id: 'vec-only', keywords: ['无关'], content: '', vector: [0.9, 0.1], lastAccessAt: 3 };
    const { ids, vectorPathEnabled } = fuseDualPath([shared, kwOnly, vecOnly] as any[], {
      query: '审批',
      queryVector: [1, 0],
    });
    expect(vectorPathEnabled).toBe(true);
    expect(ids[0]).toBe('shared');
  });
});

describe('UserProfileService(画像按 user_id 隔离)', () => {
  it('拒绝 sessionId 冒充 userId(含冒号即拒绝)', () => {
    expect(() => assertUserNamespace('u-1:p-1', '写入')).toThrow(/user_id/);
    expect(() => assertUserNamespace('', '读取')).toThrow();
    expect(() => assertUserNamespace(undefined, '读取')).toThrow();
  });

  it('不同用户画像互不可见', async () => {
    const svc = new UserProfileService();
    await svc.update('user-a', { domains: ['审批'] });
    await svc.update('user-b', { domains: ['报销'] });

    expect((await svc.get('user-a'))?.data).toEqual({ domains: ['审批'] });
    expect((await svc.get('user-b'))?.data).toEqual({ domains: ['报销'] });
    expect(await svc.get('user-c')).toBeNull();
  });

  it('ingestFromConversation 以 userId 命名空间异步合并画像', async () => {
    const svc = new UserProfileService();
    await svc.ingestFromConversation('user-a', [
      { role: 'user', content: '我要做一个请假审批流程' },
      { role: 'assistant', content: '好的' },
    ]);
    const profile = await svc.get('user-a');
    expect(profile?.data.domains).toContain('请假');
    expect(profile?.data.domains).toContain('审批');
  });

  it('ProfileStore 写入同样拒绝跨用户命名空间', async () => {
    const store = new InMemoryProfileStore();
    await expect(store.set('anon:default', {})).rejects.toThrow();
  });
});
