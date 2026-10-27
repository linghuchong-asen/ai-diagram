// 语图技术方案 - DSL 方言识别断言脚本（competitor-driven-evolution-batch Round 5）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/dsl-import.check.ts
// 覆盖：代码块围栏剥离、@startuml/graph 头识别、纯文本拒绝、importDsl 全链路（两方言 → FlowDraft）。
import { detectDsl, importDsl } from '../import/dsl-detect';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

describe('DSL 方言识别（Round 5）', () => {
  it('```mermaid 围栏:识别 mermaid 且围栏剥离', () => {
    const raw = '```mermaid\ngraph TD\nA[甲] --> B[乙]\n```';
    const result = detectDsl(raw);
    assertEqual(result.dialect, 'mermaid', '方言');
    assertTrue(result.source.startsWith('graph TD'), '围栏应剥离');
  });

  it('```plantuml / ```puml 围栏 → plantuml;无语言围栏按内容判断', () => {
    assertEqual(detectDsl('```plantuml\n@startuml\nstart\n@enduml\n```').dialect, 'plantuml', 'plantuml 围栏');
    assertEqual(detectDsl('```puml\n@startuml\nstart\n@enduml\n```').dialect, 'plantuml', 'puml 别名');
    // 无语言围栏 + @startuml 内容 → 按内容识别
    assertEqual(detectDsl('```\n@startuml\nstart\n@enduml\n```').dialect, 'plantuml', '无语言围栏按内容');
  });

  it('@startuml 头 → plantuml;graph/flowchart 头 → mermaid;前后空行容忍', () => {
    assertEqual(detectDsl('\n\n  @startuml\nstart\n@enduml  \n').dialect, 'plantuml', '@startuml 头');
    assertEqual(detectDsl('\n graph TD\nA --> B\n').dialect, 'mermaid', 'graph 头');
    assertEqual(detectDsl('flowchart LR\nA --> B').dialect, 'mermaid', 'flowchart 头');
  });

  it('纯文本/其他 DSL 特征 → null 且原因可读', () => {
    const text = detectDsl('帮我画一个请假流程图');
    assertEqual(text.dialect, null, '纯文本应拒绝');
    assertTrue(text.reason.includes('Mermaid'), '提示应说明支持的方言');
    assertEqual(detectDsl('sequenceDiagram\nA->>B: hi').dialect, null, 'mermaid 其他图型暂不支持');
  });

  it('importDsl 全链路:mermaid 源解析出 FlowDraft', () => {
    const { dialect, parse } = importDsl('```mermaid\ngraph TD\nA[开始] --> B{条件?}\nB -->|是| C((完成))\n```');
    assertEqual(dialect, 'mermaid', '方言');
    assertTrue(parse.ok && !!parse.draft, '应解析成功');
    assertEqual(parse.draft?.nodes.length, 3, '节点数');
    assertEqual(parse.draft?.nodes.find((n) => n.id === 'B')?.type, 'decision', '菱形 → decision');
  });

  it('importDsl 全链路:plantuml 源解析出 FlowDraft;垃圾输入 ok=false', () => {
    const { dialect, parse } = importDsl('@startuml\nstart\n:第一步;\nstop\n@enduml');
    assertEqual(dialect, 'plantuml', '方言');
    assertEqual(parse.draft?.nodes.length, 3, 'start+动作+stop');
    const junk = importDsl('随便写点什么');
    assertTrue(!junk.parse.ok && junk.dialect === null, '垃圾输入应失败但不抛异常');
  });
});

finish('DSL 方言识别（dsl-import.check · Round 5）');
