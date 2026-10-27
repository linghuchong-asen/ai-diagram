// 语图技术方案 - Mermaid 导入解析器断言脚本（competitor-driven-evolution-batch Round 2）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/mermaid-parser.check.ts
// 覆盖：头行校验/方向、九种形状映射、五种箭头、两种边标签、链式连接、裸引用、
//       start/end 出度修正、自环/重复定义/注释/脏行防御、纯函数不抛异常。
import { parseMermaidFlowchart } from '../import/mermaid-parser';
import { describe, it, finish, assertTrue, assertEqual, assertThrows } from './check-util';

/** 便捷:解析并断言 ok,返回 draft */
function mustParse(source: string) {
  const result = parseMermaidFlowchart(source);
  if (!result.ok || !result.draft) throw new Error(`应解析成功,实际: ${JSON.stringify(result).slice(0, 200)}`);
  return result.draft;
}

describe('① 头行与基本解析（Round 2）', () => {
  it('graph TD + 基本形状与 |标签| 边', () => {
    const draft = mustParse('graph TD\nA[开始] --> B{是否批准?}\nB -->|是| C[执行]\nB -->|否| D[驳回]');
    assertEqual(draft.nodes.length, 4, '节点数');
    const a = draft.nodes.find((n) => n.id === 'A')!;
    assertEqual(a.label, '开始', '矩形 label');
    assertEqual(a.type, 'process', '矩形 → process');
    const b = draft.nodes.find((n) => n.id === 'B')!;
    assertEqual(b.type, 'decision', '菱形 → decision');
    const yes = draft.edges.find((e) => e.label === '是')!;
    assertTrue(yes.source === 'B' && yes.target === 'C', '|标签| 边连接正确');
  });

  it('flowchart LR 亦可;方向不参与结果（布局层负责）', () => {
    const draft = mustParse('flowchart LR\nA --> B');
    assertEqual(draft.nodes.length, 2, '节点数');
    assertEqual(draft.edges.length, 1, '边数');
  });

  it('非 flowchart 图型（sequenceDiagram）返回 ok=false 供上层换方言提示', () => {
    const result = parseMermaidFlowchart('sequenceDiagram\nA->>B: hi');
    assertTrue(!result.ok, '应拒绝');
    assertTrue(result.warnings[0]!.includes('graph/flowchart'), '提示原因应说明需要 flowchart 声明');
  });

  it('空输入/仅头行 → ok=false 不抛异常', () => {
    assertThrows(() => {
      throw new Error('占位');
    }, 'assertThrows 自检');
    const empty = parseMermaidFlowchart('');
    assertTrue(!empty.ok, '空输入应 ok=false');
    const onlyHeader = parseMermaidFlowchart('graph TD');
    assertTrue(!onlyHeader.ok, '仅头行应 ok=false');
  });
});

describe('② 形状映射（九种）', () => {
  const cases: Array<[string, string, string, string]> = [
    ['A[矩形]', 'A', '矩形', 'process'],
    ['A(圆角)', 'A', '圆角', 'process'],
    ['A{菱形}', 'A', '菱形', 'decision'],
    ['A{{六边形}}', 'A', '六边形', 'process'],
    ['A[[子程序]]', 'A', '子程序', 'subprocess'],
    ['A[(数据库)]', 'A', '数据库', 'io'],
    ['A[/平行四边形/]', 'A', '平行四边形', 'io'],
    ['A[\\反向平行\\]', 'A', '反向平行', 'io'],
    ['A>旗形]', 'A', '旗形', 'io'],
  ];
  for (const [decl, id, label, type] of cases) {
    it(`${decl} → ${type}`, () => {
      const draft = mustParse(`graph TD\n${decl}`);
      const node = draft.nodes.find((n) => n.id === id)!;
      assertEqual(node.label, label, 'label');
      assertEqual(node.type, type, 'type');
    });
  }
});

describe('③ 箭头与边标签', () => {
  it('五种箭头均可建边:--> --- ==>.->->', () => {
    const draft = mustParse([
      'graph TD',
      'A[甲] --> B[乙]',
      'B --- C[丙]',
      'C ==> D[丁]',
      'D -.-> E[戊]',
      'D -> F[己]',
    ].join('\n'));
    assertEqual(draft.edges.length, 5, '五种箭头各一条边');
  });

  it('内联文字标签:-- 是 --> / == 重点 ==> / -. 虚线 .->', () => {
    const draft = mustParse([
      'graph TD',
      'A -- 是 --> B',
      'B == 重点 ==> C',
      'C -. 虚线 .-> D',
    ].join('\n'));
    assertEqual(draft.edges.find((e) => e.source === 'A')?.label, '是', '普通内联标签');
    assertEqual(draft.edges.find((e) => e.source === 'B')?.label, '重点', '粗箭头内联标签');
    assertEqual(draft.edges.find((e) => e.source === 'C')?.label, '虚线', '虚线内联标签');
  });

  it('链式连接 A --> B --> C 生成两条边', () => {
    const draft = mustParse('graph LR\nA[甲] --> B[乙] --> C[丙]');
    assertEqual(draft.edges.length, 2, '两条边');
    assertTrue(draft.edges.every((e) => e.source !== e.target), '无自环');
  });
});

describe('④ 语义推断与防御（Round 2）', () => {
  it('圆形/体育场:有出边 → start;无出边 → end（出度修正）', () => {
    const draft = mustParse('graph TD\nA((开始)) --> B[处理]\nB --> C([结束])');
    assertEqual(draft.nodes.find((n) => n.id === 'A')!.type, 'start', '有出边圆形 → start');
    assertEqual(draft.nodes.find((n) => n.id === 'C')!.type, 'end', '无出边体育场 → end');
  });

  it('裸引用节点:label=id 且 type=process;后置形状定义可补全', () => {
    const draft = mustParse('graph TD\nA --> B\nB{补定义为菱形}');
    const first = draft.nodes.find((n) => n.id === 'B')!;
    assertEqual(first.type, 'decision', '后置形状定义应覆盖裸引用');
    assertEqual(first.label, '补定义为菱形', 'label 同步更新');
  });

  it('自环边跳过并记 warning;注释行剔除;脏行降级不抛异常', () => {
    const result = parseMermaidFlowchart([
      'graph TD',
      '%% 这是一行注释',
      'A[甲] --> A',
      'A --> B[乙]',
      '!!! 不认识的行 !!!',
    ].join('\n'));
    assertTrue(result.ok, '整体仍应解析成功');
    assertEqual(result.draft?.edges.length, 1, '自环被跳过,仅剩一条边');
    assertTrue(result.warnings.some((w) => w.includes('自环')), '自环应有 warning');
    assertTrue(result.warnings.some((w) => w.includes('无法识别')), '脏行应有 warning');
  });

  it('重复定义:保留首个带形状定义;引号 label 去除', () => {
    const draft = mustParse('graph TD\nA["带引号"] --> B\nA[重复定义]');
    assertEqual(draft.nodes.find((n) => n.id === 'A')!.label, '带引号', '引号应剥离');
  });

  it('纯函数:同一输入两次解析结果一致', () => {
    const src = 'graph TD\nA[甲] --> B{乙?}\nB -->|是| C((丙))';
    const r1 = JSON.stringify(parseMermaidFlowchart(src));
    const r2 = JSON.stringify(parseMermaidFlowchart(src));
    assertEqual(r1, r2, '解析应为确定性纯函数');
  });
});

describe('⑤ 高级语法（Round 3）', () => {
  it('subgraph:组行/end 不产生节点;组内裸节点→subprocess;带形状节点保持原类型', () => {
    const result = parseMermaidFlowchart([
      'graph TD',
      'subgraph 阶段一 [准备阶段]',
      '  B --> C{确认?}',
      'end',
      'A[开始] --> B',
      'C --> D((完成))',
    ].join('\n'));
    assertTrue(result.ok, '应解析成功');
    const draft = result.draft!;
    // subgraph 行本身不产生节点:业务节点为 A/B/C/D 共 4 个
    assertEqual(draft.nodes.length, 4, 'subgraph 行不产生节点');
    assertEqual(draft.nodes.find((n) => n.id === 'B')!.type, 'subprocess', '组内裸节点 → subprocess');
    assertEqual(draft.nodes.find((n) => n.id === 'C')!.type, 'decision', '组内带形状节点保持 decision');
    assertTrue(result.warnings.some((w) => w.includes('subgraph 分组')), '分组框丢弃应有 warning 说明');
  });

  it('嵌套 subgraph 与未闭合 end:不抛异常且如实提示', () => {
    const result = parseMermaidFlowchart([
      'graph TD',
      'subgraph 外层',
      '  A[甲] --> B[乙]',
      '  subgraph 内层',
      '    B --> C[丙]',
      '  end',
      'end',
      'A --> D[丁]',
    ].join('\n'));
    assertTrue(result.ok, '嵌套解析成功');
    assertEqual(result.draft?.nodes.length, 4, '嵌套组不影响节点计数');
    // 未闭合场景
    const unclosed = parseMermaidFlowchart('graph TD\nsubgraph 组\nA[甲] --> B[乙]');
    assertTrue(unclosed.ok, '未闭合不抛异常');
    assertTrue(unclosed.warnings.some((w) => w.includes('未全部闭合')), '未闭合应有 warning');
  });

  it('样式/交互/方向指令行容忍跳过,不产生节点', () => {
    const draft = mustParse([
      'graph TD',
      'A[甲] --> B[乙]',
      'style A fill:#f9f,stroke:#333',
      'classDef cls fill:#bbf',
      'class A cls',
      'linkStyle 0 stroke:#f66',
      'click B callback',
      'direction LR',
    ].join('\n'));
    assertEqual(draft.nodes.length, 2, '指令行不产生节点');
    assertEqual(draft.edges.length, 1, '指令行不影响边');
  });

  it('& 并联展开:A --> B & C 两条边;A & B --> C 两条边', () => {
    const fanOut = mustParse('graph TD\nA[甲] --> B[乙] & C[丙]');
    assertEqual(fanOut.edges.length, 2, '一对多展开');
    assertTrue(fanOut.edges.every((e) => e.source === 'A'), '源均为 A');
    const fanIn = mustParse('graph TD\nB[乙] & C[丙] --> D[丁]');
    assertEqual(fanIn.edges.length, 2, '多对一展开');
    assertTrue(fanIn.edges.every((e) => e.target === 'D'), '目标均为 D');
  });

  it('& 并联 + |标签|:标签挂到该段所有展开边', () => {
    const draft = mustParse('graph TD\nA[甲] -->|并行| B[乙] & C[丙]');
    assertEqual(draft.edges.length, 2, '展开边数');
    assertTrue(draft.edges.every((e) => e.label === '并行'), '两条边均带标签');
  });

  it('带引号与特殊字符的 label 不受影响', () => {
    const draft = mustParse('graph TD\nA["含,逗号 与 空格"] --> B["含 | 竖线"]');
    assertEqual(draft.nodes.find((n) => n.id === 'A')!.label, '含,逗号 与 空格', '逗号空格保留');
  });

  it('链式 + 并联混合:A --> B & C --> D 每段独立建边', () => {
    const draft = mustParse('graph TD\nA[甲] --> B[乙] & C[丙] --> D[丁]');
    // 段1: A→B, A→C; 段2: B→D, C→D
    assertEqual(draft.edges.length, 4, '两段共 4 条边');
    assertTrue(draft.edges.some((e) => e.source === 'B' && e.target === 'D'), 'B→D 存在');
    assertTrue(draft.edges.some((e) => e.source === 'C' && e.target === 'D'), 'C→D 存在');
  });
});

finish('Mermaid 导入解析器（mermaid-parser.check · Round 2-3）');
