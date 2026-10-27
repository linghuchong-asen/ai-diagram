// 语图 Round D（utils/toMermaid）可执行断言脚本
// 覆盖：六种语义节点的形状映射、id 归一与去重、标签/边标签清洗、
//      端点缺失边丢弃、方向切换、头部署名注释、空图兜底。
// 运行：cd frontend && npx tsx src/utils/__checks__/toMermaid.check.ts

import { flowDraftToMermaid, type MermaidFlowDraft } from '../toMermaid';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../pages/ai/__checks__/check-util';

describe('flowDraftToMermaid：六种语义节点的形状映射', () => {
  it('start/end 圆角胶囊、process 矩形、decision 菱形、io 平行四边形、subprocess 子程序框', () => {
    const mermaid = flowDraftToMermaid(
      {
        nodes: [
          { id: 'a', label: '开始', type: 'start' },
          { id: 'b', label: '处理', type: 'process' },
          { id: 'c', label: '判断', type: 'decision' },
          { id: 'd', label: '输入', type: 'io' },
          { id: 'e', label: '子流程', type: 'subprocess' },
          { id: 'f', label: '结束', type: 'end' },
        ],
        edges: [{ source: 'a', target: 'b' }],
      },
      { headerComment: 'TEST' },
    );
    const lines = mermaid.split('\n');
    assertTrue(lines.includes('    a(["开始"])'), 'start 应为圆角胶囊');
    assertTrue(lines.includes('    b["处理"]'), 'process 应为矩形');
    assertTrue(lines.includes('    c{"判断"}'), 'decision 应为菱形');
    assertTrue(lines.includes('    d[/"输入"/]'), 'io 应为平行四边形');
    assertTrue(lines.includes('    e[["子流程"]]'), 'subprocess 应为子程序框');
    assertTrue(lines.includes('    f(["结束"])'), 'end 应为圆角胶囊');
  });

  it('未知类型降级为 process（与 resolveNodeType 降级语义一致）', () => {
    const mermaid = flowDraftToMermaid(
      { nodes: [{ id: 'x', label: '未知', type: 'weird' }], edges: [] },
      { headerComment: 'TEST' },
    );
    assertTrue(mermaid.includes('    x["未知"]'), '未知类型应按 process 矩形输出');
  });
});

describe('边：标签语法与悬空引用防御', () => {
  it('带标签边输出 -->|label| 形式，无标签边输出 --> 形式', () => {
    const mermaid = flowDraftToMermaid(
      {
        nodes: [
          { id: 'a', label: 'A', type: 'process' },
          { id: 'b', label: 'B', type: 'process' },
          { id: 'c', label: 'C', type: 'process' },
        ],
        edges: [
          { source: 'a', target: 'b', label: '通过' },
          { source: 'b', target: 'c' },
        ],
      },
      { headerComment: 'TEST' },
    );
    assertTrue(mermaid.includes('    a -->|通过| b'), '带标签边格式错误');
    assertTrue(mermaid.includes('    b --> c'), '无标签边格式错误');
  });

  it('端点不存在的边被丢弃（不产生悬空 id 引用，与 droppedEdges 同语义）', () => {
    const mermaid = flowDraftToMermaid(
      {
        nodes: [{ id: 'a', label: 'A', type: 'process' }],
        edges: [
          { source: 'a', target: 'ghost' },
          { source: 'ghost', target: 'a' },
        ],
      },
      { headerComment: 'TEST' },
    );
    assertTrue(!mermaid.includes('-->'), '悬空边应全部丢弃');
  });

  it('边标签中的竖线被替换（| 为 Mermaid 边标签语法符）', () => {
    const mermaid = flowDraftToMermaid(
      {
        nodes: [
          { id: 'a', label: 'A', type: 'process' },
          { id: 'b', label: 'B', type: 'process' },
        ],
        edges: [{ source: 'a', target: 'b', label: '是|否' }],
      },
      { headerComment: 'TEST' },
    );
    assertTrue(mermaid.includes('a -->|是/否| b'), '竖线应替换为斜杠');
    assertTrue(!mermaid.includes('是|否'), '不应残留原始竖线');
  });
});

describe('标签与 id 清洗', () => {
  it('节点标签内双引号转单引号、换行折叠（引号串内引号会破坏语法）', () => {
    const mermaid = flowDraftToMermaid(
      { nodes: [{ id: 'a', label: '他说"好"\n再换行', type: 'process' }], edges: [] },
      { headerComment: 'TEST' },
    );
    assertTrue(mermaid.includes('["他说\'好\' 再换行"]'), '引号应转单引号、换行折叠为空格');
  });

  it('id 非法字符归一为下划线，空 id 按序号兜底，重复 id 追加序号去重', () => {
    const mermaid = flowDraftToMermaid(
      {
        nodes: [
          { id: 'node.1', label: 'A', type: 'process' },
          { id: '', label: 'B', type: 'process' },
          { id: 'node.1', label: 'A2', type: 'process' },
        ],
        edges: [],
      },
      { headerComment: 'TEST' },
    );
    assertTrue(mermaid.includes('    node_1["A"]'), '非法字符应替换为下划线');
    assertTrue(mermaid.includes('    n1["B"]'), '空 id 应回落 n1');
    assertTrue(mermaid.includes('    node_1_2["A2"]'), '重复 id 应追加序号去重');
  });
});

describe('整体结构', () => {
  it('头部署名注释 + flowchart TD 声明（默认 TD）', () => {
    const mermaid = flowDraftToMermaid({ nodes: [], edges: [] }, { headerComment: '署名测试' });
    assertEqual(mermaid.split('\n')[0], '%% 署名测试', '首行应为 %% 注释');
    assertEqual(mermaid.split('\n')[1], 'flowchart TD', '默认方向 TD');
  });

  it('direction: LR 切换布局方向', () => {
    const mermaid = flowDraftToMermaid({ nodes: [], edges: [] }, { direction: 'LR', headerComment: 'T' });
    assertEqual(mermaid.split('\n')[1], 'flowchart LR', '应输出 LR');
  });

  it('空图（nodes/edges 缺失防御）不抛错且语法合法', () => {
    const mermaid = flowDraftToMermaid({} as MermaidFlowDraft, { headerComment: 'T' });
    assertTrue(mermaid.startsWith('%% T\nflowchart TD\n'), '空图应仅含注释与声明');
  });
});

finish('toMermaid');
