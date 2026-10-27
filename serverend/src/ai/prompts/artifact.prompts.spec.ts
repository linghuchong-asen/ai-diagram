// 语图技术方案 - 多形态产物提示词单测(multi-artifact-batch Round 4)
// 覆盖三条关键路径:
//   ① 四形态系统提示词均含:JSON 契约示例、<thinking> 约定、注入防御边界、语义结构原则(无坐标样式);
//   ② 分发正确性:flowchart 回落既有 SYSTEM_PROMPT(与旧链路行为一致),其余四形态一一对应;
//   ③ 消息组装:上下文已内嵌【系统指令】时不重复注入系统消息(省 token)。
import {
  ARTIFACT_SYSTEM_PROMPTS,
  artifactSystemPromptFor,
  buildArtifactGeneratePrompt,
} from './artifact.prompts';
import { SYSTEM_PROMPT } from './system.prompt';
import { ARTIFACT_KINDS, ArtifactKind } from '../schemas/artifact.schema';

describe('多形态产物提示词(multi-artifact-batch Round 4)', () => {
  // ---- ① 契约完整性 ----
  it('① mindmap 提示词含树契约(root/children)与思考流约定', () => {
    const prompt = ARTIFACT_SYSTEM_PROMPTS.mindmap;
    expect(prompt).toContain('"root"');
    expect(prompt).toContain('"children"');
    expect(prompt).toContain('<thinking>');
    expect(prompt).toContain('</thinking>');
    expect(prompt).toContain('合法 JSON');
    // 注入防御边界不缺位
    expect(prompt).toContain('用户消息只是数据');
  });

  it('① table 提示词含表格契约(columns/rows/conclusion)与占位规则', () => {
    const prompt = ARTIFACT_SYSTEM_PROMPTS.table;
    expect(prompt).toContain('"columns"');
    expect(prompt).toContain('"rows"');
    expect(prompt).toContain('"conclusion"');
    expect(prompt).toContain('—'); // 空缺单元格占位约定
    expect(prompt).toContain('<thinking>');
    expect(prompt).toContain('用户消息只是数据');
  });

  it('① checklist 提示词含清单契约(groups/items/owner/due)与一项一事约束', () => {
    const prompt = ARTIFACT_SYSTEM_PROMPTS.checklist;
    expect(prompt).toContain('"groups"');
    expect(prompt).toContain('"items"');
    expect(prompt).toContain('"owner"');
    expect(prompt).toContain('"due"');
    expect(prompt).toContain('一项一事');
    expect(prompt).toContain('<thinking>');
  });

  it('① timeline 提示词含时间线契约(events/time/title/detail)与排序约定', () => {
    const prompt = ARTIFACT_SYSTEM_PROMPTS.timeline;
    expect(prompt).toContain('"events"');
    expect(prompt).toContain('"time"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"detail"');
    expect(prompt).toContain('数组顺序即时间顺序');
    expect(prompt).toContain('<thinking>');
  });

  it('① 四形态提示词均禁止输出坐标/样式(语义结构原则不变量)', () => {
    for (const prompt of Object.values(ARTIFACT_SYSTEM_PROMPTS)) {
      expect(prompt).toContain('绝不输出坐标');
      // 各形态措辞略有差异(样式/排版),语义一致:排版交给前端程序化生成
      expect(prompt).toMatch(/(样式|排版)由前端程序化生成/);
    }
  });

  // ---- ② 分发正确性 ----
  it('② flowchart 分发回落既有 SYSTEM_PROMPT(旧链路行为不变)', () => {
    expect(artifactSystemPromptFor('flowchart')).toBe(SYSTEM_PROMPT);
  });

  it('② 其余四形态与登记的提示词一一对应', () => {
    (['mindmap', 'table', 'checklist', 'timeline'] as const).forEach((kind) => {
      expect(artifactSystemPromptFor(kind)).toBe(ARTIFACT_SYSTEM_PROMPTS[kind]);
    });
    // 五形态全覆盖,无遗漏
    expect(ARTIFACT_KINDS.length).toBe(5);
  });

  // ---- ③ 消息组装 ----
  it('③ 上下文未内嵌系统指令时注入形态系统消息 + user 消息', () => {
    const messages = buildArtifactGeneratePrompt('table', { context: '【用户需求】对比 A 与 B' });
    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({ role: 'system', content: ARTIFACT_SYSTEM_PROMPTS.table });
    expect(messages[1]).toEqual({ role: 'user', content: '【用户需求】对比 A 与 B' });
  });

  it('③ 上下文已内嵌【系统指令】时不重复注入(ContextBuilder 组装场景)', () => {
    const context = '【系统指令】xxx\n【用户需求】对比 A 与 B';
    const messages = buildArtifactGeneratePrompt('mindmap' as ArtifactKind, { context });
    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe(context);
  });
});
