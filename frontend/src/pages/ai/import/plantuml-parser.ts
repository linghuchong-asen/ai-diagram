// 语图技术方案 - PlantUML activity 导入解析器（competitor-driven-evolution-batch Round 4）
// 背景：PlantUML 是 UML 领域事实标准（竞品 FlowGPT 等 LLM 常直接输出 PlantUML）；Kroki 等渲染
//       生态把它列为一级方言。承接 PlantUML 存量资产与 G1（DSL 互操作）同源。
// 设计原则（与 mermaid-parser 一致）：纯函数、不抛异常、脏语法降级 warning、输出语义 FlowDraft。
// 支持范围（activity 新语法为主）：
//   @startuml/@enduml、start/stop/end、:动作;、if(cond) then(是)/else(否)/endif、
//   while(cond) is(是)/endwhile(否)、repeat/repeat while(cond) is(是)、
//   fork/fork again/end fork、-> 标签;、partition 分组（忽略框保留节点）、note/title 跳过、detach 断流。
// 实现要点：栈式控制流机——pending（当前开放末端集合）+ 控制帧（if/while/repeat/fork 的分支收集）。
import type { MermaidNode, MermaidEdge, MermaidFlowDraft, MermaidParseResult } from './mermaid-parser';

/** 控制流帧:if/while/repeat/fork 的分支上下文 */
interface ControlFrame {
  kind: 'if' | 'while' | 'repeat' | 'fork';
  /** if/while:判定节点 id;repeat/fork 无判定 */
  decision?: string;
  /** repeat:循环体首节点(回流目标);fork:各分支共同入口的 pending 快照 */
  bodyEntry?: string;
  entrySnapshot?: string[];
  /** 各分支末端的累积(汇合点) */
  branchEnds: string[];
}

/** 去除 :text; 的动作定界并清洗（#颜色前缀、首尾空白） */
function cleanAction(text: string): string {
  return text.replace(/^#+/, '').trim();
}

/** 提取括号内条件文本:if (x?) then (是) → { cond:'x?', yes:'是' } */
function extractParens(line: string): string[] {
  const results: string[] = [];
  const re = /\(([^()]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    results.push(match[1]!.trim());
  }
  return results;
}

/**
 * 解析 PlantUML activity 源码 → 语图 FlowDraft。
 * 不是 activity 图（如 sequenceDiagram/classDiagram）或无任何可识别语句时返回 ok=false。
 */
export function parsePlantumlActivity(source: string): MermaidParseResult {
  const warnings: string[] = [];
  const nodesById = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  let counter = 0;
  /** 当前开放末端:下一条语句的源节点集合（fork 汇合/分支合并后会有多个） */
  let pending: string[] = [];
  /** 下一条建边要挂的标签（-> 标签; 或分支标签） */
  let pendingLabel: string | undefined;
  const stack: ControlFrame[] = [];
  /** partition/group 嵌套深度:分组框忽略,但要知道 end/endgroup 别误判 */
  let groupDepth = 0;
  let noteDepth = 0;
  let sawActivity = false;

  const lines = String(source ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // 头行:@startuml（可带图名）
  if (!lines[0] || !/^@startuml/i.test(lines[0]!)) {
    return { ok: false, warnings: ['首行不是 @startuml 声明（可能不是 PlantUML 文本）'] };
  }

  const createNode = (label: string, type: MermaidNode['type']): string => {
    counter += 1;
    const id = `p${counter}`;
    nodesById.set(id, { id, label, type });
    return id;
  };

  const connectFrom = (sources: string[], target: string, label: string | undefined) => {
    for (const sourceId of sources) {
      if (sourceId === target) continue;
      counter += 1;
      edges.push({ id: `pe${counter}`, source: sourceId, target, label });
    }
  };

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // @enduml 之后忽略（多图粘贴容错）
    if (/^@enduml/i.test(line)) break;
    // note 块:note ... / end note 整体跳过
    if (noteDepth > 0) {
      if (/^(end\s*note|endnote)$/i.test(line)) noteDepth = 0;
      continue;
    }
    if (/^note\b/i.test(line)) {
      noteDepth = /^end\s*note$/i.test(line) ? 0 : 1;
      continue;
    }
    // 独立指令行跳过
    if (/^(title|caption|legend|skinparam|scale|autonumber|footer|header|actor|startuml)\b/i.test(line)) continue;

    // ---- 分组框:partition/group 忽略框只保留内容 ----
    if (/^(partition|group)\b/i.test(line)) {
      groupDepth += 1;
      continue;
    }
    if (/^(end\s*partition|endpartition|end\s*group|endgroup)\b/i.test(line) && groupDepth > 0) {
      groupDepth -= 1;
      continue;
    }

    // ---- 断流指令 ----
    if (/^(detach|kill)\b/i.test(line)) {
      pending = [];
      pendingLabel = undefined;
      sawActivity = true;
      continue;
    }

    // ---- start / stop / end ----
    if (/^start$/i.test(line)) {
      const id = createNode('开始', 'start');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      pending = [id];
      sawActivity = true;
      continue;
    }
    if (/^(stop|end)$/i.test(line)) {
      // end 在控制帧未闭合时优先视为 endif/endwhile 收帧?PlantUML 新语法用 endif/endwhile,
      //独立的 end 即终止节点;若误写按终止处理并提示
      if (stack.length > 0) {
        warnings.push(`第 ${lineNo} 行:控制块未闭合即遇到 ${line},已按终止节点处理`);
        stack.length = 0;
      }
      const id = createNode('结束', 'end');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      pending = [];
      sawActivity = true;
      continue;
    }

    // ---- :动作;（可带 #颜色前缀,如 #hotPink:标红动作;） ----
    const action = line.match(/^(?:#[A-Za-z0-9_]+)?:\s*([^;]*);?\s*;?$/);
    if (action) {
      const id = createNode(cleanAction(action[1]!) || '（空动作）', 'process');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      pending = [id];
      sawActivity = true;
      // repeat 帧:记录循环体首节点(首个出现在 repeat 之后的节点)
      const top = stack[stack.length - 1];
      if (top && top.kind === 'repeat' && !top.bodyEntry) top.bodyEntry = id;
      continue;
    }

    // ---- -> 标签; ----
    const arrowLabel = line.match(/^->\s*([^;]+);?\s*$/);
    if (arrowLabel) {
      pendingLabel = arrowLabel[1]!.trim();
      continue;
    }

    // ---- if (cond) then (yes) ----
    if (/^if\b/i.test(line)) {
      const parens = extractParens(line);
      const cond = parens[0] || '条件?';
      const yes = parens[1];
      const id = createNode(cond, 'decision');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      stack.push({ kind: 'if', decision: id, branchEnds: [] });
      pending = [id];
      pendingLabel = yes || '是';
      sawActivity = true;
      continue;
    }

    // ---- else (no) ----
    if (/^else\b/i.test(line)) {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== 'if') {
        warnings.push(`第 ${lineNo} 行:else 不在 if 块内,已跳过`);
        continue;
      }
      top.branchEnds.push(...pending);
      pending = [top.decision!];
      pendingLabel = extractParens(line)[0] || '否';
      sawActivity = true;
      continue;
    }

    // ---- endif ----
    if (/^endif$/i.test(line)) {
      const top = stack.pop();
      if (!top || top.kind !== 'if') {
        warnings.push(`第 ${lineNo} 行:endif 无对应 if,已跳过`);
        continue;
      }
      top.branchEnds.push(...pending);
      pending = top.branchEnds;
      pendingLabel = undefined;
      sawActivity = true;
      continue;
    }

    // ---- while (cond) is (yes) ----
    if (/^while\b/i.test(line)) {
      const parens = extractParens(line);
      const cond = parens[0] || '循环条件?';
      const yes = parens[1];
      const id = createNode(cond, 'decision');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      stack.push({ kind: 'while', decision: id, branchEnds: [] });
      pending = [id];
      pendingLabel = yes || '是';
      sawActivity = true;
      continue;
    }

    // ---- endwhile (no) ----
    if (/^endwhile\b/i.test(line)) {
      const top = stack.pop();
      if (!top || top.kind !== 'while') {
        warnings.push(`第 ${lineNo} 行:endwhile 无对应 while,已跳过`);
        continue;
      }
      // 循环体末端回流判定节点(构成环,布局层已有环图 guard)
      connectFrom(pending, top.decision!, undefined);
      pending = [top.decision!];
      pendingLabel = extractParens(line)[0] || '否';
      sawActivity = true;
      continue;
    }

    // ---- repeat while (cond) is (yes) ----（须先于裸 repeat 判定,否则会被 repeat 分支吞掉） */
    if (/^repeat\s+while\b/i.test(line)) {
      const top = stack.pop();
      if (!top || top.kind !== 'repeat') {
        warnings.push(`第 ${lineNo} 行:repeat while 无对应 repeat,已跳过`);
        continue;
      }
      const parens = extractParens(line);
      const id = createNode(parens[0] || '循环条件?', 'decision');
      connectFrom(pending, id, pendingLabel);
      pendingLabel = undefined;
      // 「是」回流循环体首节点;无体(空 repeat)时回流判定自身形成自环 → 跳过
      if (top.bodyEntry) {
        counter += 1;
        edges.push({ id: `pe${counter}`, source: id, target: top.bodyEntry, label: parens[1] || '是' });
      } else {
        warnings.push(`第 ${lineNo} 行:repeat 无循环体,回流边已跳过`);
      }
      pending = [id];
      pendingLabel = extractParens(line)[2] || '否';
      sawActivity = true;
      continue;
    }

    // ---- repeat ----
    if (/^repeat\b/i.test(line)) {
      stack.push({ kind: 'repeat', branchEnds: [] });
      sawActivity = true;
      continue;
    }

    // ---- fork / fork again / end fork ----
    if (/^fork$/i.test(line) || /^fork\s+again$/i.test(line) || /^end\s*fork|^endfork$/i.test(line)) {
      const isAgain = /again/i.test(line);
      const isEnd = /end/i.test(line);
      if (!isAgain && !isEnd) {
        // fork 起点:快照当前末端,各分支从同一处出发
        stack.push({ kind: 'fork', entrySnapshot: [...pending], branchEnds: [] });
      } else if (isAgain) {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== 'fork') {
          warnings.push(`第 ${lineNo} 行:fork again 无对应 fork,已跳过`);
          continue;
        }
        top.branchEnds.push(...pending);
        pending = [...top.entrySnapshot!];
      } else {
        const top = stack.pop();
        if (!top || top.kind !== 'fork') {
          warnings.push(`第 ${lineNo} 行:end fork 无对应 fork,已跳过`);
          continue;
        }
        top.branchEnds.push(...pending);
        pending = top.branchEnds;
      }
      sawActivity = true;
      continue;
    }

    // 其余未识别行:如实记录(不中断)
    warnings.push(`第 ${lineNo} 行:无法识别,已跳过（${line.slice(0, 20)}）`);
  }

  if (!sawActivity || nodesById.size === 0) {
    return { ok: false, warnings: [...warnings, '未解析到 activity 语句（可能是 sequence/class 等其他 PlantUML 图型）'] };
  }
  if (stack.length > 0) {
    warnings.push(`存在 ${stack.length} 个未闭合控制块(if/while/repeat/fork),结果可能不完整`);
  }

  return { ok: true, draft: { nodes: [...nodesById.values()], edges }, warnings };
}
