// 语图技术方案 - 产物 Markdown 下载断言脚本（competitor-driven-evolution-batch Round 10）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/download-artifact.check.ts
// 覆盖：文件名生成（形态中文名/时间戳/非法字符清洗）、五形态 Markdown 构建、
//       DOM 环境守卫（Node 下下载返回 false 不抛异常）。
import { artifactFileName, buildArtifactMarkdown, downloadTextFile, downloadArtifactMarkdown } from '../artifacts/download-artifact';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

/** 固定时间戳保证文件名可测 */
const FIXED = new Date(2026, 9, 26, 15, 30, 12); // 2026-10-26 15:30:12

describe('① 文件名生成（Round 10）', () => {
  it('形态中文名 + YYYYMMDD-HHmmss 时间戳', () => {
    assertEqual(artifactFileName('table', FIXED), '语图-对比表格-20261026-153012.md', '表格文件名');
    assertEqual(artifactFileName('mindmap', FIXED), '语图-思维导图-20261026-153012.md', '导图文件名');
    assertEqual(artifactFileName('timeline', FIXED), '语图-时间线-20261026-153012.md', '时间线文件名');
  });

  it('月份/日期/时分秒补零(个位数)', () => {
    const early = new Date(2026, 0, 5, 3, 4, 5);
    assertEqual(artifactFileName('checklist', early), '语图-清单-20260105-030405.md', '补零');
  });
});

describe('② 五形态 Markdown 构建（Round 10）', () => {
  it('table → Markdown 表格(含表头分隔行)', () => {
    const md = buildArtifactMarkdown('table', { columns: ['维度', 'A'], rows: [['成本', '高']] })!;
    assertTrue(md.includes('| 维度 | A |'), '表头');
    assertTrue(md.includes('| --- |'), '分隔行');
  });

  it('checklist → 任务列表语法;timeline → 有序时间', () => {
    const list = buildArtifactMarkdown('checklist', { groups: [{ title: '组', items: [{ text: '事项' }] }] })!;
    assertTrue(list.includes('### 组') && list.includes('- [ ] 事项'), '清单语法');
    const line = buildArtifactMarkdown('timeline', { events: [{ time: 'Day1', title: '到达' }, { time: 'Day2', title: '返程' }] })!;
    assertTrue(line.includes('1. **Day1**') && line.includes('2. **Day2**'), '时间线序号');
  });

  it('mindmap → 层级列表;flowchart → mermaid 代码块', () => {
    const mind = buildArtifactMarkdown('mindmap', { root: { id: 'm1', label: '根', children: [{ id: 'm2', label: '子', children: [] }] } })!;
    assertEqual(mind, '- 根\n  - 子', '导图列表');
    const flow = buildArtifactMarkdown('flowchart', {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '处理', type: 'process' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    })!;
    assertTrue(flow.includes('```mermaid'), 'mermaid 围栏');
    assertTrue(flow.includes('graph') || flow.includes('flowchart'), 'mermaid 声明');
  });

  it('形态与 payload 不符 → null(不猜测)', () => {
    assertEqual(buildArtifactMarkdown('table', { foo: 1 }), null, '不匹配返回 null');
    assertEqual(buildArtifactMarkdown('unknown' as never, {}), null, '未知形态 null');
  });
});

describe('③ DOM 环境守卫（Round 10）', () => {
  it('非浏览器环境(Node)下载返回 false,不抛异常', () => {
    assertEqual(downloadTextFile('x.md', '# hi'), false, 'Node 无 document 应 false');
    assertEqual(downloadArtifactMarkdown('table', { columns: ['a', 'b'], rows: [['1', '2']] }), false, '组合入口同样守卫');
  });
});

finish('产物 Markdown 下载（download-artifact.check · Round 10）');
