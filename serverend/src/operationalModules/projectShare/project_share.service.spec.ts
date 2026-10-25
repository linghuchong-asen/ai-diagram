// 语图 V1.1：分享服务单测（纯逻辑直测，mock 仓库，不起 Nest TestingModule）
import { HttpException, HttpStatus } from '@nestjs/common';
import { ProjectShareService } from './project_share.service';
import type { ProjectShareEntity } from './entities/project_share.entity';

/** 仓库桩：service 只用 findOne / save / delete / create 四个方法 */
function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((x: Partial<ProjectShareEntity>) => x),
  };
}

function makeService() {
  const shareRepo = makeRepo();
  const projectRepo = makeRepo();
  const editorRepo = makeRepo();
  // Task 2/4 依赖桩:QuotaService(分享获赠) + GrowthEventService(share_create 埋点)
  const quota = { grantShareBonus: jest.fn(async () => undefined) };
  const growth = { track: jest.fn() };
  const service = new ProjectShareService(
    shareRepo as never,
    projectRepo as never,
    editorRepo as never,
    quota as never,
    growth as never,
  );
  return { service, shareRepo, projectRepo, editorRepo, quota, growth };
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
