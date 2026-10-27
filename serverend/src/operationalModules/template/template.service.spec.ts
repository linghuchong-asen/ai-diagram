// 语图 Task 7：模板中心单测（纯逻辑直测，无需 mock）
// Round C（2026-10-26）：场景扩充 12 → 16（会议纪要/PRD/技术路线图/年终述职）。
// competitor-driven-evolution-batch Round 18：新增「多形态」分类 16 → 20（四形态模板带 formHint）。
// 社区模板批次：投稿/审核/公开列表（仓库桩直测）。
import { HttpException } from '@nestjs/common';
import {
  FlowTemplate,
  TEMPLATE_CATEGORIES,
  TemplateService,
} from './template.service';

function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    create: jest.fn((x: unknown) => x),
    find: jest.fn(async () => []),
  };
}

describe('TemplateService（Task 7：模板中心）', () => {
  const service = new TemplateService(makeRepo() as never, makeRepo() as never, makeRepo() as never);
  const list: FlowTemplate[] = service.listTemplates();

  it('返回 20 个预置模板（Round 18 扩充：+四形态模板）', () => {
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(20);
  });

  it('Round C 新增模板均在列（会议纪要/PRD/技术路线图/年终述职）', () => {
    const ids = list.map((template) => template.id);
    for (const newId of [
      'work-meeting-minutes',
      'dev-prd-user-flow',
      'campus-thesis-roadmap',
      'work-year-review',
    ]) {
      expect(ids).toContain(newId);
    }
  });

  it('Round 18 四形态模板在列且 formHint 与分类配对（多形态专属）', () => {
    const ids = list.map((template) => template.id);
    for (const newId of ['multi-tech-selection', 'multi-meeting-todo', 'multi-trip-timeline', 'multi-reading-mindmap']) {
      expect(ids).toContain(newId);
    }
    const legalHints = ['mindmap', 'table', 'checklist', 'timeline'];
    for (const template of list) {
      if (template.category === '多形态') {
        // 多形态分类必须携带合法 formHint(四新形态各一,不含 flowchart——它是缺省不需要)
        expect(legalHints).toContain(template.formHint);
      } else {
        // 旧分类模板不带 formHint(维持流程图语义)
        expect(template.formHint).toBeUndefined();
      }
    }
  });

  it('字段完整且非空（id/name/category/scene/description/prompt）', () => {
    for (const template of list) {
      expect(String(template.id ?? '').trim().length).toBeGreaterThan(0);
      expect(String(template.name ?? '').trim().length).toBeGreaterThan(0);
      expect(String(template.scene ?? '').trim().length).toBeGreaterThan(0);
      expect(String(template.description ?? '').trim().length).toBeGreaterThan(0);
      // prompt 是直接喂 AI 的生成指令，必须是有分量的完整句
      expect(String(template.prompt ?? '').trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it('id 全局唯一（前端以 id 作 key）', () => {
    const ids = list.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('分类均为合法枚举（校园/职场/电商/研发/多形态）', () => {
    for (const template of list) {
      expect(TEMPLATE_CATEGORIES).toContain(template.category);
    }
  });

  it('五个分类均有覆盖（保证过滤 chips 不出现空分类）', () => {
    const categories = new Set(list.map((template) => template.category));
    expect(categories.size).toBe(TEMPLATE_CATEGORIES.length);
  });

  it('多次调用返回一致内容（静态预置，无随机态）', () => {
    expect(service.listTemplates()).toEqual(list);
  });
});

describe('社区模板（community-template-batch）', () => {
  function makeCommunityService() {
    const communityRepo = makeRepo();
    const projectRepo = makeRepo();
    const shareRepo = makeRepo();
    const service = new TemplateService(
      communityRepo as never,
      projectRepo as never,
      shareRepo as never,
    );
    return { service, communityRepo, projectRepo, shareRepo };
  }

  it('投稿：归属校验 404（不存在/非本人统一文案）', async () => {
    const { service, projectRepo } = makeCommunityService();
    projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'owner-b', project_name: 'X' });
    await expect(service.submitCommunity('owner-a', '1')).rejects.toMatchObject({
      status: 404,
      message: '项目不存在',
    });
  });

  it('投稿成功：pending 待审 + 署名快照 + 无分享则代建（不发奖励）', async () => {
    const { service, communityRepo, projectRepo, shareRepo } = makeCommunityService();
    projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', project_name: '请假审批流' });
    communityRepo.findOne.mockResolvedValue(null); // 未投过
    shareRepo.findOne.mockResolvedValue(null); // 无既有分享
    const saved = await service.submitCommunity('u1', '1', '请假场景', '小图');
    expect(saved).toMatchObject({
      projectId: '1',
      ownerName: '小图',
      title: '请假审批流',
      status: 'pending',
    });
    // 代建分享（32 位 hex token），且社区投稿事件走 customLogger（不走 share_create）
    expect(shareRepo.save).toHaveBeenCalledTimes(1);
    expect((shareRepo.save as jest.Mock).mock.calls[0][0].shareToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('重复投稿 → 400（projectId 唯一，防灌水）', async () => {
    const { service, communityRepo, projectRepo } = makeCommunityService();
    projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', project_name: 'X' });
    communityRepo.findOne.mockResolvedValue({ id: 't1', projectId: '1' });
    await expect(service.submitCommunity('u1', '1')).rejects.toMatchObject({ status: 400 });
  });

  it('既有分享复用 token（不重复建分享）', async () => {
    const { service, communityRepo, projectRepo, shareRepo } = makeCommunityService();
    projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', project_name: 'X' });
    communityRepo.findOne.mockResolvedValue(null);
    shareRepo.findOne.mockResolvedValue({ shareToken: 'a'.repeat(32), projectId: '1' });
    const saved = await service.submitCommunity('u1', '1');
    expect(saved.shareToken).toBe('a'.repeat(32));
    expect(shareRepo.save).not.toHaveBeenCalled();
  });

  it('公开列表：仅 approved；审核流转 pending → approved / rejected', async () => {
    const { service, communityRepo } = makeCommunityService();
    communityRepo.find.mockResolvedValue([
      { id: 't1', title: 'A', description: '', ownerName: 'x', shareToken: 't' },
    ]);
    const list = await service.listCommunity();
    expect(list).toHaveLength(1);
    // find 只查 approved
    expect((communityRepo.find as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { status: 'approved' },
    });

    // 审核：pending → approved
    communityRepo.findOne.mockResolvedValue({ id: 't1', status: 'pending' });
    const approved = await service.reviewCommunity('t1', true);
    expect(approved.status).toBe('approved');
    // 已处理的再审 → 404
    communityRepo.findOne.mockResolvedValue({ id: 't1', status: 'approved' });
    await expect(service.reviewCommunity('t1', false)).rejects.toMatchObject({ status: 404 });
    // 不存在 → 404
    communityRepo.findOne.mockResolvedValue(null);
    await expect(service.reviewCommunity('ghost', true)).rejects.toBeInstanceOf(HttpException);
  });
});

describe('我的社区作品（投稿者数据面板）', () => {
  it('仅返回本人投稿，带审核状态与热度字段', async () => {
    const communityRepo = makeRepo();
    const projectRepo = makeRepo();
    const shareRepo = makeRepo();
    const service = new TemplateService(communityRepo as never, projectRepo as never, shareRepo as never);
    communityRepo.find.mockResolvedValue([
      { id: 't1', title: 'A', status: 'approved', viewCount: 11, copyCount: 2, shareToken: 't', ownerId: 'u1' },
    ]);

    const mine = await service.listMyCommunity('u1');

    // 查询条件限定本人
    expect((communityRepo.find as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { ownerId: 'u1' },
    });
    expect(mine).toEqual([
      { id: 't1', title: 'A', status: 'approved', viewCount: 11, copyCount: 2, shareToken: 't' },
    ]);
  });
});
