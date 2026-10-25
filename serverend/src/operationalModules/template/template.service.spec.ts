// 语图 Task 7：模板中心单测（纯静态数据，纯逻辑直测，无需 mock）
import {
  FlowTemplate,
  TEMPLATE_CATEGORIES,
  TemplateService,
} from './template.service';

describe('TemplateService（Task 7：模板中心）', () => {
  const service = new TemplateService();
  const list: FlowTemplate[] = service.listTemplates();

  it('返回 12 个预置模板', () => {
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(12);
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

  it('分类均为合法枚举（校园/职场/电商/研发）', () => {
    for (const template of list) {
      expect(TEMPLATE_CATEGORIES).toContain(template.category);
    }
  });

  it('四个分类均有覆盖（保证过滤 chips 不出现空分类）', () => {
    const categories = new Set(list.map((template) => template.category));
    expect(categories.size).toBe(TEMPLATE_CATEGORIES.length);
  });

  it('多次调用返回一致内容（静态预置，无随机态）', () => {
    expect(service.listTemplates()).toEqual(list);
  });
});
