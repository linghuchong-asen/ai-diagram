// 语图 V1.1：分享服务单测（纯逻辑直测，mock 仓库，不起 Nest TestingModule）
import { HttpException, HttpStatus } from '@nestjs/common';
import { ProjectShareService } from './project_share.service';
import type { ProjectShareEntity } from './entities/project_share.entity';

/** 仓库桩：service 只用 findOne / save / delete / create / query 五个方法 */
function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((x: Partial<ProjectShareEntity>) => x),
    query: jest.fn(async () => []),
  };
}

function makeService() {
  const shareRepo = makeRepo();
  const projectRepo = makeRepo();
  const editorRepo = makeRepo();
  const userRepo = makeRepo();
  // 模板使用统计批次:社区模板计数仓库桩（query 为 UPDATE 计数,默认静默）
  const communityRepo = makeRepo();
  (communityRepo.query as jest.Mock).mockResolvedValue([]);
  // 投稿激励批次:复制里程碑领取记录仓库桩
  const copyRewardRepo = makeRepo();
  (copyRewardRepo.query as jest.Mock).mockResolvedValue([]);
  // 商业化闭环批次:JwtService 桩(可选鉴权识别 owner,默认无令牌场景用不到)
  const jwtService = { verifyAsync: jest.fn() };
  // Task 2/4 依赖桩:QuotaService(分享获赠) + GrowthEventService(share_create 埋点)
  const quota = { grantShareBonus: jest.fn(async () => undefined) };
  const growth = { track: jest.fn() };
  // 投稿激励批次:会员天数发放桩
  const billing = { grantVipDays: jest.fn(async () => new Date()) };
  const service = new ProjectShareService(
    shareRepo as never,
    projectRepo as never,
    editorRepo as never,
    userRepo as never,
    communityRepo as never,
    copyRewardRepo as never,
    billing as never,
    jwtService as never,
    quota as never,
    growth as never,
  );
  return { service, shareRepo, projectRepo, editorRepo, userRepo, communityRepo, copyRewardRepo, jwtService, quota, growth, billing };
}

describe('ProjectShareService（V1.1：免登录只读分享）', () => {
  describe('createShare（幂等创建）', () => {
    it('项目不存在 → 返回 null（controller 转 404）', async () => {
      const { service, projectRepo } = makeService();
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.createShare('999', 'u1')).resolves.toBeNull();
    });

    it('项目归属他人 → 403「无权访问该项目」', async () => {
      const { service, projectRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'owner-b' });
      await expect(service.createShare('1', 'owner-a')).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('已有分享 → 幂等复用原 token，不新建记录', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.findOne.mockResolvedValue({ shareToken: 'tok-existing', projectId: '1' });
      const result = await service.createShare('1', 'u1');
      expect(result).toEqual({ shareToken: 'tok-existing' });
      expect(shareRepo.save).not.toHaveBeenCalled();
    });

    it('首次创建 → 生成 32 位十六进制 token 并保存归属', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.findOne.mockResolvedValue(null);
      const result = await service.createShare('1', 'u1');
      expect(result?.shareToken).toMatch(/^[0-9a-f]{32}$/);
      expect(shareRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: '1', userId: 'u1' }),
      );
    });

    it('历史项目 userId 为 NULL（未归属）→ 不拦截，分享可创建', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: null });
      shareRepo.findOne.mockResolvedValue(null);
      await expect(service.createShare('1', 'u1')).resolves.toEqual({
        shareToken: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
    });
  });

  describe('viewShare（免登录公开读取）', () => {
    it('token 不存在/已撤销 → 404 统一文案（不泄露存在性）', async () => {
      const { service, shareRepo } = makeService();
      shareRepo.findOne.mockResolvedValue(null);
      await expect(service.viewShare('nope')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      try {
        await service.viewShare('nope');
        throw new Error('应当抛出 HttpException');
      } catch (e) {
        const err = e as HttpException;
        expect(err.message).toBe('分享链接不存在或已失效');
      }
    });

    it('分享存在但文档缺失 → 同样 404 统一文案', async () => {
      const { service, shareRepo, editorRepo } = makeService();
      shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: '1' });
      editorRepo.findOne.mockResolvedValue(null);
      await expect(service.viewShare('t')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('正常读取 → 返回项目名 + 画布 JSON + 解锁态（不回传 userId）', async () => {
      const { service, shareRepo, editorRepo, projectRepo } = makeService();
      shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: '1', userId: 'u1' });
      editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
      projectRepo.findOne.mockResolvedValue({ id: '1', project_name: '电商订单流程' });
      const view = await service.viewShare('t');
      expect(view).toEqual({
        projectName: '电商订单流程',
        editorData: [{ shape: 'rect' }],
        unlocked: false,
      });
      expect(JSON.stringify(view)).not.toContain('u1');
    });

    it('editorData 非数组（脏数据）→ 兜底空数组防整页崩溃', async () => {
      const { service, shareRepo, editorRepo, projectRepo } = makeService();
      shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: '1' });
      editorRepo.findOne.mockResolvedValue({ editorData: null });
      projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X' });
      const view = await service.viewShare('t');
      expect(view.editorData).toEqual([]);
    });
  });

  describe('viewShare 分享页浏览埋点（快赢批次一 QW1）', () => {
    it('成功读取 → track("share_view") 恰一次（projectId + token，不带用户身份）', async () => {
      const { service, shareRepo, editorRepo, projectRepo, growth } = makeService();
      shareRepo.findOne.mockResolvedValue({ shareToken: 'tok-1', projectId: 'p-1' });
      editorRepo.findOne.mockResolvedValue({ editorData: [] });
      projectRepo.findOne.mockResolvedValue({ id: 'p-1', project_name: 'X' });
      await service.viewShare('tok-1');
      expect(growth.track).toHaveBeenCalledTimes(1);
      expect(growth.track).toHaveBeenCalledWith('share_view', {
        projectId: 'p-1',
        token: 'tok-1',
      });
    });

    it('token 不存在/文档缺失（404 路径）→ 不记事件（防刷日志）', async () => {
      const { service, shareRepo, editorRepo, growth } = makeService();
      shareRepo.findOne.mockResolvedValue(null);
      await expect(service.viewShare('nope')).rejects.toThrow();
      shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: '1' });
      editorRepo.findOne.mockResolvedValue(null);
      await expect(service.viewShare('t')).rejects.toThrow();
      expect(growth.track).not.toHaveBeenCalled();
    });
  });

  describe('duplicateShare（复制分享为我的项目，快赢批次一 QW2）', () => {
    /** 构造一份可正常读取的分享数据：首查(viewShare 项目查询)返回项目，其后查重一律返回 null */
    function mockValidShare(ctx: ReturnType<typeof makeService>) {
      ctx.shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: 'src-1' });
      ctx.editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
      // viewShare 内 project 查询取首个 Once;名称查重走默认 null(不冲突)
      ctx.projectRepo.findOne
        .mockResolvedValueOnce({ id: 'src-1', project_name: '请假流程' })
        .mockResolvedValue(null);
      ctx.projectRepo.create.mockImplementation((x: Record<string, unknown>) => x);
      ctx.editorRepo.create.mockImplementation((x: Record<string, unknown>) => x);
      ctx.projectRepo.save.mockImplementation(async (x: { project_name?: string }) => ({
        id: 'new-1',
        ...x,
      }));
    }

    it('正常复制 → 新建归属本人的项目 + 复制画布文档 + 记 share_duplicate', async () => {
      const ctx = makeService();
      mockValidShare(ctx);
      const result = await ctx.service.duplicateShare('t', 'u9');
      expect(result).toEqual({ projectId: 'new-1', projectName: '请假流程 · 副本' });
      // 项目:名称加「· 副本」后缀、归属复制者、解锁态不继承
      expect(ctx.projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          project_name: '请假流程 · 副本',
          userId: 'u9',
          unlocked: false,
        }),
      );
      // 文档:画布内容随项目复制
      expect(ctx.editorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'new-1', editorData: [{ shape: 'rect' }] }),
      );
      // 事件:viewShare 的 share_view + 复制的 share_duplicate 各一次
      expect(ctx.growth.track).toHaveBeenCalledWith('share_duplicate', {
        userId: 'u9',
        projectId: 'new-1',
      });
      const events = ctx.growth.track.mock.calls.map((call) => call[0]);
      expect(events).toContain('share_view');
    });

    it('「原名 · 副本」重名 → 追加序号直到不冲突', async () => {
      const ctx = makeService();
      mockValidShare(ctx);
      // 依次:viewShare 项目查询 → 「副本」已存在 → 「副本2」已存在 → 「副本3」可用
      ctx.projectRepo.findOne
        .mockReset()
        .mockResolvedValueOnce({ id: 'src-1', project_name: '请假流程' })
        .mockResolvedValueOnce({ id: 'dup-1' })
        .mockResolvedValueOnce({ id: 'dup-2' })
        .mockResolvedValue(null);
      ctx.projectRepo.create.mockImplementation((x: Record<string, unknown>) => x);
      ctx.projectRepo.save.mockImplementation(async (x: { project_name?: string }) => ({
        id: 'new-2',
        ...x,
      }));
      const result = await ctx.service.duplicateShare('t', 'u9');
      expect(result.projectName).toBe('请假流程 · 副本3');
    });

    it('token 无效 → 404，不创建任何数据、不记 share_duplicate', async () => {
      const ctx = makeService();
      ctx.shareRepo.findOne.mockResolvedValue(null);
      await expect(ctx.service.duplicateShare('nope', 'u9')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      expect(ctx.projectRepo.save).not.toHaveBeenCalled();
      expect(ctx.editorRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeShare（撤销）', () => {
    it('物理删除记录；affected>0 → true', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.revokeShare('1', 'u1')).resolves.toBe(true);
      expect(shareRepo.delete).toHaveBeenCalledWith({ projectId: '1' });
    });

    it('无记录可删（本就未分享）→ false，不报错', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.revokeShare('1', 'u1')).resolves.toBe(false);
    });

    it('项目不存在 → null；归属他人 → 403', async () => {
      const { service, projectRepo, shareRepo } = makeService();
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.revokeShare('9', 'u1')).resolves.toBeNull();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'owner-b' });
      await expect(service.revokeShare('1', 'owner-a')).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
      expect(shareRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('createShare 分享获赠 + 埋点（Task 2/4）', () => {
    it('首次创建成功 → grantShareBonus 恰一次 + track("share_create") 恰一次', async () => {
      const { service, projectRepo, shareRepo, quota, growth } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.findOne.mockResolvedValue(null);
      await service.createShare('1', 'u1');
      expect(quota.grantShareBonus).toHaveBeenCalledTimes(1);
      expect(quota.grantShareBonus).toHaveBeenCalledWith('u1');
      expect(growth.track).toHaveBeenCalledTimes(1);
      expect(growth.track).toHaveBeenCalledWith('share_create', {
        userId: 'u1',
        projectId: '1',
      });
    });

    it('幂等复用已有 token → 零奖励、零埋点（防刷）', async () => {
      const { service, projectRepo, shareRepo, quota, growth } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1' });
      shareRepo.findOne.mockResolvedValue({ shareToken: 'tok-existing', projectId: '1' });
      await service.createShare('1', 'u1');
      expect(quota.grantShareBonus).not.toHaveBeenCalled();
      expect(growth.track).not.toHaveBeenCalled();
    });

    it('项目不存在 → 零奖励、零埋点', async () => {
      const { service, projectRepo, quota, growth } = makeService();
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.createShare('999', 'u1')).resolves.toBeNull();
      expect(quota.grantShareBonus).not.toHaveBeenCalled();
      expect(growth.track).not.toHaveBeenCalled();
    });

    it('历史项目 userId 为 NULL（未归属）→ 不发奖励（无用户可记）,埋点 userId 记 null', async () => {
      const { service, projectRepo, shareRepo, quota, growth } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: null });
      shareRepo.findOne.mockResolvedValue(null);
      await service.createShare('1', null);
      expect(quota.grantShareBonus).not.toHaveBeenCalled();
      expect(growth.track).toHaveBeenCalledWith('share_create', {
        userId: null,
        projectId: '1',
      });
    });
  });
});

describe('viewShare 可选鉴权（商业化闭环批次）', () => {
  function stubView(mocks: {
    shareRepo: any; editorRepo: any; projectRepo: any; userRepo: any; jwtService: any;
  }) {
    mocks.shareRepo.findOne.mockResolvedValue({ shareToken: 't', projectId: '1' });
    mocks.editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
  }

  it('访客（无令牌）→ 与旧版完全一致，不回传 isOwner/projectId', async () => {
    const { service, shareRepo, editorRepo, projectRepo } = makeService();
    stubView({ shareRepo, editorRepo, projectRepo, userRepo: null as never, jwtService: null as never });
    projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X', unlocked: false, userId: 'owner-b' });
    const view = await service.viewShare('t');
    expect(view).toEqual({ projectName: 'X', editorData: [{ shape: 'rect' }], unlocked: false });
    expect(view.isOwner).toBeUndefined();
    expect(view.projectId).toBeUndefined();
  });

  it('owner 令牌 → isOwner:true + projectId 回传（解锁直达动线）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, userRepo, jwtService } = makeService();
    stubView({ shareRepo, editorRepo, projectRepo, userRepo, jwtService });
    projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X', unlocked: false, userId: 'u1' });
    userRepo.findOne.mockResolvedValue({ id: 'u1', vipExpireTime: null });
    jwtService.verifyAsync.mockResolvedValue({ id: 'u1' });
    const view = await service.viewShare('t', 'bearer-token');
    expect(view.isOwner).toBe(true);
    expect(view.projectId).toBe('1');
    expect(view.unlocked).toBe(false);
  });

  it('owner 是在期会员 → unlocked:true（全站免水印权益）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, userRepo, jwtService } = makeService();
    stubView({ shareRepo, editorRepo, projectRepo, userRepo, jwtService });
    projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X', unlocked: false, userId: 'u1' });
    userRepo.findOne.mockResolvedValue({ id: 'u1', vipExpireTime: new Date(Date.now() + 86_400_000) });
    jwtService.verifyAsync.mockResolvedValue({ id: 'u1' });
    const view = await service.viewShare('t', 'bearer-token');
    expect(view.unlocked).toBe(true);
  });

  it('非 owner 登录用户 → 不回传 isOwner（不泄露归属）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, userRepo, jwtService } = makeService();
    stubView({ shareRepo, editorRepo, projectRepo, userRepo, jwtService });
    projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X', unlocked: false, userId: 'owner-b' });
    userRepo.findOne.mockResolvedValue({ id: 'viewer-a', vipExpireTime: null });
    jwtService.verifyAsync.mockResolvedValue({ id: 'viewer-a' });
    const view = await service.viewShare('t', 'bearer-token');
    expect(view.isOwner).toBeUndefined();
    expect(view.projectId).toBeUndefined();
  });

  it('无效令牌 → 安静降级为访客，公开读取不受影响', async () => {
    const { service, shareRepo, editorRepo, projectRepo, userRepo, jwtService } = makeService();
    stubView({ shareRepo, editorRepo, projectRepo, userRepo, jwtService });
    projectRepo.findOne.mockResolvedValue({ id: '1', project_name: 'X', unlocked: false, userId: 'owner-b' });
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const view = await service.viewShare('t', 'broken-token');
    expect(view.isOwner).toBeUndefined();
    expect(view.projectName).toBe('X');
  });
});

describe('模板使用统计（template-usage-stats-batch）', () => {
  it('viewShare 成功 → view_count +1（旁路：token 无命中行零成本，失败不影响主链路）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'a'.repeat(32), projectId: 'p-1' });
    editorRepo.findOne.mockResolvedValue({ editorData: [] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-1', project_name: 'X', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);

    await service.viewShare('a'.repeat(32));

    expect(communityRepo.query).toHaveBeenCalled();
    const sql = String((communityRepo.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('view_count');
    expect((communityRepo.query as jest.Mock).mock.calls[0][1]).toEqual(['a'.repeat(32)]);
  });

  it('duplicateShare 成功 → copy_count +1', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'b'.repeat(32), projectId: 'p-2' });
    editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-2', project_name: 'Y', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);

    await service.duplicateShare('b'.repeat(32), 'u9');

    // duplicate 内部复用 viewShare 做 token 校验 → 先有 view_count，后有 copy_count
    const sqls = (communityRepo.query as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('copy_count'))).toBe(true);
  });

  it('计数失败 → 查看/复制主链路不受影响（旁路静默）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'a'.repeat(32), projectId: 'p-1' });
    editorRepo.findOne.mockResolvedValue({ editorData: [] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-1', project_name: 'X', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);
    (communityRepo.query as jest.Mock).mockRejectedValue(new Error('db down'));

    const view = await service.viewShare('a'.repeat(32));
    expect(view.projectName).toBe('X');
  });
});

/** viewShare/duplicateShare 里对新项目/文档的落库走 save 桩 */
function userRepoStubs(projectRepo: { save: jest.Mock }, editorRepo: { save: jest.Mock }) {
  (projectRepo as unknown as { save: jest.Mock }).save = jest.fn(async (x: unknown) => ({ id: 'p-new', ...(x as object) }));
  (editorRepo as unknown as { save: jest.Mock }).save = jest.fn(async (x: unknown) => x);
}

describe('投稿激励：复制里程碑（community-reward-batch）', () => {
  /** trackCommunityCopy 是 fire-and-forget 微任务链：flush 两轮微任务确保断言前执行完 */
  const flushAsync = () => new Promise((r) => setTimeout(r, 0));

  function stubCopy(communityRepo: any, copyCount: number, ownerId: string) {
    // duplicateShare 链路：communityRepo.query 依次为 [0]=view_count（fire-forget）、[1]=copy RETURNING
    communityRepo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ copy_count: copyCount, owner_id: ownerId }]);
  }

  it('被复制第 5 次 → 跨 5 档自动送投稿人 1 天会员（20 档未达不触碰）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo, copyRewardRepo, billing } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'c'.repeat(32), projectId: 'p-3' });
    editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-3', project_name: 'Z', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);
    stubCopy(communityRepo, 5, 'owner-1');
    copyRewardRepo.query.mockResolvedValue([{ milestone: 5 }]); // 5 档抢占成功

    await service.duplicateShare('c'.repeat(32), 'u9');
    await flushAsync();

    expect(billing.grantVipDays).toHaveBeenCalledWith('owner-1', 1, 'community_copy_milestone');
    // 20 档未达标被守卫跳过：仅 5 档一次领取 INSERT
    expect(copyRewardRepo.query).toHaveBeenCalledTimes(1);
  });

  it('里程碑已领取过（抢占无返回行）→ 不重复发放', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo, copyRewardRepo, billing } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'c'.repeat(32), projectId: 'p-3' });
    editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-3', project_name: 'Z', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);
    stubCopy(communityRepo, 5, 'owner-1');
    copyRewardRepo.query.mockResolvedValue([]); // ON CONFLICT DO NOTHING 无返回

    await service.duplicateShare('c'.repeat(32), 'u9');
    await flushAsync();

    expect(billing.grantVipDays).not.toHaveBeenCalled();
  });

  it('未达任何档位（被复制 2 次）→ 不触碰领取表', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo, copyRewardRepo, billing } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'c'.repeat(32), projectId: 'p-3' });
    editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-3', project_name: 'Z', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);
    stubCopy(communityRepo, 2, 'owner-1');

    await service.duplicateShare('c'.repeat(32), 'u9');
    await flushAsync();

    expect(copyRewardRepo.query).not.toHaveBeenCalled();
    expect(billing.grantVipDays).not.toHaveBeenCalled();
  });

  it('发放抛错 → 静默旁路（复制主链路不受影响）', async () => {
    const { service, shareRepo, editorRepo, projectRepo, communityRepo, copyRewardRepo, billing } = makeService();
    shareRepo.findOne.mockResolvedValue({ shareToken: 'c'.repeat(32), projectId: 'p-3' });
    editorRepo.findOne.mockResolvedValue({ editorData: [{ shape: 'rect' }] });
    projectRepo.findOne.mockResolvedValue({ id: 'p-3', project_name: 'Z', unlocked: false, userId: 'u1' });
    userRepoStubs(projectRepo, editorRepo);
    stubCopy(communityRepo, 5, 'owner-1');
    copyRewardRepo.query.mockResolvedValue([{ milestone: 5 }]);
    billing.grantVipDays.mockRejectedValue(new Error('db down'));

    const result = await service.duplicateShare('c'.repeat(32), 'u9');
    await flushAsync();
    expect(result).toMatchObject({ projectId: 'p-new' });
  });
});
