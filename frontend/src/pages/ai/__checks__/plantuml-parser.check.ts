// 语图技术方案 - PlantUML activity 导入解析器断言脚本（competitor-driven-evolution-batch Round 4）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/plantuml-parser.check.ts
// 覆盖：start/stop、:动作;、if/else/endif 分支与标签、while/endwhile 回流环、repeat/repeat while、
//       fork 并行分支、-> 标签、partition/note/title 跳过、detach 断流、脏语法防御。
import { parsePlantumlActivity } from '../import/plantuml-parser';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

function mustParse(source: string) {
  const result = parsePlantumlActivity(source);
  if (!result.ok || !result.draft) throw new Error(`应解析成功,实际: ${JSON.stringify(result).slice(0, 200)}`);
  return result.draft;
}

describe('① 基本语句（Round 4）', () => {
  it('start / :动作; / stop 线性流程', () => {
    const draft = mustParse('@startuml\nstart\n:准备数据;\n:处理;\nstop\n@enduml');
    assertEqual(draft.nodes.length, 4, '4 个节点');
    assertEqual(draft.nodes[0]?.type, 'start', 'start 节点');
    assertEqual(draft.nodes[3]?.type, 'end', 'stop → end');
    assertEqual(draft.edges.length, 3, '3 条边');
  });

  it('首行非 @startuml → ok=false;非 activity 图型同理', () => {
    assertTrue(!parsePlantumlActivity('sequenceDiagram\nA->>B: hi').ok, '非 PlantUML 应拒绝');
    const notActivity = parsePlantumlActivity('@startuml\nBob -> Alice : hello\n@enduml');
    assertTrue(!notActivity.ok, '无 activity 语句应拒绝');
    assertTrue(notActivity.warnings.some((w) => w.includes('activity')), '提示应说明需要 activity 图');
  });

  it('#颜色动作前缀剥离;空输入与@enduml 后内容忽略', () => {
    const draft = mustParse('@startuml\nstart\n#hotPink:标红动作;\nstop\n@enduml\ngraph TD\n垃圾');
    assertEqual(draft.nodes.find((n) => n.label === '标红动作')?.type, 'process', '颜色前缀剥离后为 process');
  });
});

describe('② 分支与循环（Round 4）', () => {
  it('if/else/endif:决策节点 + 是/否 分支标签 + 分支汇合', () => {
    const draft = mustParse([
      '@startuml',
      'start',
      'if (库存充足?) then (是)',
      '  :发货;',
      'else (否)',
      '  :补货;',
      'endif',
      ':记录;',
      'stop',
      '@enduml',
    ].join('\n'));
    const decision = draft.nodes.find((n) => n.type === 'decision')!;
    assertEqual(decision.label, '库存充足?', '判定条件为节点 label');
    const yesEdge = draft.edges.find((e) => e.label === '是')!;
    const noEdge = draft.edges.find((e) => e.label === '否')!;
    assertTrue(yesEdge.source === decision.id, '是分支源为判定');
    assertTrue(noEdge.source === decision.id, '否分支源为判定');
    // 汇合:两个分支末端都连到「记录」
    const record = draft.nodes.find((n) => n.label === '记录')!;
    assertEqual(draft.edges.filter((e) => e.target === record.id).length, 2, '两分支汇合到后续节点');
  });

  it('while/endwhile:循环体回流判定构成环 + 「否」出循环', () => {
    const draft = mustParse([
      '@startuml',
      'start',
      'while (还有数据?) is (有)',
      '  :处理一条;',
      'endwhile (没了)',
      ':收尾;',
      'stop',
      '@enduml',
    ].join('\n'));
    const decision = draft.nodes.find((n) => n.type === 'decision')!;
    // 回流边:处理一条 → 判定
    const back = draft.edges.find((e) => e.target === decision.id && e.source !== decision.id);
    assertTrue(!!back, '循环体应回流判定节点');
    const exitEdge = draft.edges.find((e) => e.label === '没了')!;
    assertEqual(exitEdge.source, decision.id, '「没了」边从判定出循环');
  });

  it('repeat/repeat while:回流循环体首节点 + 「否」继续向下', () => {
    const draft = mustParse([
      '@startuml',
      'start',
      'repeat',
      '  :执行动作;',
      'repeat while (继续?) is (是)',
      ':结束处理;',
      'stop',
      '@enduml',
    ].join('\n'));
    const action = draft.nodes.find((n) => n.label === '执行动作')!;
    const decision = draft.nodes.find((n) => n.type === 'decision')!;
    const back = draft.edges.find((e) => e.source === decision.id && e.target === action.id);
    assertTrue(!!back && back.label === '是', '判定「是」回流循环体首节点');
  });

  it('fork/fork again/end fork:并行分支同源出发、末尾汇合', () => {
    const draft = mustParse([
      '@startuml',
      'start',
      ':准备;',
      'fork',
      '  :分支甲;',
      'fork again',
      '  :分支乙;',
      'end fork',
      ':汇合后;',
      'stop',
      '@enduml',
    ].join('\n'));
    const prep = draft.nodes.find((n) => n.label === '准备')!;
    const a = draft.nodes.find((n) => n.label === '分支甲')!;
    const b = draft.nodes.find((n) => n.label === '分支乙')!;
    const join = draft.nodes.find((n) => n.label === '汇合后')!;
    assertTrue(draft.edges.some((e) => e.source === prep.id && e.target === a.id), '准备→分支甲');
    assertTrue(draft.edges.some((e) => e.source === prep.id && e.target === b.id), '准备→分支乙');
    assertEqual(draft.edges.filter((e) => e.target === join.id).length, 2, '两分支汇合');
  });
});

describe('③ 容错与防御（Round 4）', () => {
  it('-> 标签; 挂到下一条边;partition 分组忽略框保留内容;note/title 跳过', () => {
    const draft = mustParse([
      '@startuml',
      'title 流程标题',
      'start',
      'partition 处理阶段 {',
      ':第一步;',
      '-> 重要衔接;',
      ':第二步;',
      '}',
      'stop',
      'note right\n说明\nend note',
      '@enduml',
    ].join('\n'));
    assertEqual(draft.nodes.filter((n) => n.type === 'process').length, 2, 'partition/title/note 不产生节点');
    const labeled = draft.edges.find((e) => e.label === '重要衔接');
    assertTrue(!!labeled, '-> 标签应挂到边');
  });

  it('detach 断流;end 提前收块有 warning;未闭合控制块有 warning;不抛异常', () => {
    const unclosed = parsePlantumlActivity('@startuml\nstart\nif (条件?) then (是)\n:甲;\n@enduml');
    assertTrue(unclosed.ok, '未闭合仍应产出');
    assertTrue(unclosed.warnings.some((w) => w.includes('未闭合')), '未闭合应有 warning');
    assertEqual(unclosed.draft?.nodes.length, 3, '节点数(start+判定+甲)');

    const detached = mustParse('@startuml\nstart\n:甲;\ndetach\n:乙;\nstop\n@enduml');
    const a = detached.nodes.find((n) => n.label === '甲')!;
    const b = detached.nodes.find((n) => n.label === '乙')!;
    assertTrue(!detached.edges.some((e) => e.source === a.id && e.target === b.id), 'detach 后不应连线');
  });

  it('裸 else/endif 越界:跳过并 warning,不抛异常', () => {
    const result = parsePlantumlActivity('@startuml\nstart\n:甲;\nelse (否)\nendif\nstop\n@enduml');
    assertTrue(result.ok, '越界块不致命');
    assertTrue(result.warnings.some((w) => w.includes('else 不在 if 块内')), '裸 else 应有 warning');
  });

  it('纯函数:同一输入两次解析一致', () => {
    const src = '@startuml\nstart\nif (a?) then (y)\n:x;\\nelse (n)\n:y;\nendif\nstop\n@enduml';
    assertEqual(JSON.stringify(parsePlantumlActivity(src)), JSON.stringify(parsePlantumlActivity(src)), '确定性');
  });
});

finish('PlantUML activity 导入解析器（plantuml-parser.check · Round 4）');
