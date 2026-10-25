// 语图技术方案 - 反思:图遍历确定性校验(第二层)
// 文档:结构合理 = 图遍历判定(断头节点/缺下游分支/未闭环/节点类型错误/决策节点无分支)
// 全部用确定性程序实现,不依赖 LLM 自评。
// Task 9.1 新增:HAS_CYCLE 环检测(DFS 三色染色法),severity = warning(不阻断)。
import { FlowDraft } from '../schemas/flow-draft.schema';
import { NODE_TYPES, NodeType } from '../schemas/node.schema';

export type GraphIssueType =
  | 'DANGLING_NODE' // 断头:入度/出度为零(除 start/end)
  | 'NO_OUTPUT_BRANCH' // 缺下游分支:节点无出边(除 end)
  | 'MISSING_START'
  | 'MISSING_END'
  | 'INVALID_TYPE' // 节点类型不在枚举中
  | 'DECISION_NO_BRANCH' // 决策节点出度 < 2
  | 'UNREACHABLE_NODE' // 从 start 不可达
  | 'EDGE_REFERENCES_MISSING_NODE' // 边引用不存在的节点
  | 'NO_UNIQUE_ID'
  | 'HAS_CYCLE'; // 存在回环(审批不通过→退回上一环节),属业务合法形态,仅告警

/**
 * 问题级别(Task 9.1):
 *  - error  :结构确实不合法,阻断产出,必须走 Rewriter 修正;
 *  - warning:结构可运行但值得关注(如回环),不阻断,只提示模型与用户。
 */
export type GraphIssueSeverity = 'error' | 'warning';

export interface GraphIssue {
  type: GraphIssueType;
  nodeId?: string;
  message: string;
  /** 默认 error;仅「合法但需提示」的问题标 warning */
  severity?: GraphIssueSeverity;
  /** 环路径等附加信息(节点 id 序列) */
  detail?: string[];
}

export interface GraphValidationResult {
  /** 无 error 级问题即视为通过(warning 不阻断) */
  valid: boolean;
  issues: GraphIssue[];
}

/** error 级问题构造 */
function errorIssue(type: GraphIssueType, message: string, extra?: Partial<GraphIssue>): GraphIssue {
  return { type, message, severity: 'error', ...extra };
}

/** warning 级问题构造 */
function warningIssue(type: GraphIssueType, message: string, extra?: Partial<GraphIssue>): GraphIssue {
  return { type, message, severity: 'warning', ...extra };
}

export class GraphValidator {
  validate(draft: FlowDraft): GraphValidationResult {
    const issues: GraphIssue[] = [];
    const { nodes, edges } = draft;

    // 1. 必须有 start 与 end
    if (!nodes.some((n) => n.type === 'start')) {
      issues.push(errorIssue('MISSING_START', '缺少 start 节点'));
    }
    if (!nodes.some((n) => n.type === 'end')) {
      issues.push(errorIssue('MISSING_END', '缺少 end 节点'));
    }

    // 2. 类型合法性
    const validTypes: NodeType[] = [...NODE_TYPES];
    for (const n of nodes) {
      if (!validTypes.includes(n.type as NodeType)) {
        issues.push(
          errorIssue('INVALID_TYPE', `节点 ${n.id} 类型非法: ${n.type}`, { nodeId: n.id }),
        );
      }
    }

    // 3. id 唯一性
    const seenIds = new Map<string, boolean>();
    for (const n of nodes) {
      if (seenIds.has(n.id)) {
        issues.push(errorIssue('NO_UNIQUE_ID', `节点 id 重复: ${n.id}`, { nodeId: n.id }));
      }
      seenIds.set(n.id, true);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const outDegree = new Map<string, number>();
    const inDegree = new Map<string, number>();
    nodes.forEach((n) => {
      outDegree.set(n.id, 0);
      inDegree.set(n.id, 0);
    });

    // 4. 边引用合法性
    for (const e of edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
        issues.push(
          errorIssue('EDGE_REFERENCES_MISSING_NODE', `边 ${e.id} 引用了不存在的节点: ${e.source}->${e.target}`, {
            detail: [e.source, e.target],
          }),
        );
        continue;
      }
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    // 5. 断头/缺分支
    for (const n of nodes) {
      if (n.type === 'start') {
        if (outDegree.get(n.id) === 0) {
          issues.push(errorIssue('NO_OUTPUT_BRANCH', `start 节点 ${n.id} 没有出边`, { nodeId: n.id }));
        }
      } else if (n.type === 'end') {
        // end 无出边是合法的
      } else if ((outDegree.get(n.id) ?? 0) === 0) {
        issues.push(errorIssue('NO_OUTPUT_BRANCH', `节点 ${n.id} 没有出边(缺下游)`, { nodeId: n.id }));
      }

      // 决策节点必须 >=2 分支
      if (n.type === 'decision' && (outDegree.get(n.id) ?? 0) < 2) {
        issues.push(errorIssue('DECISION_NO_BRANCH', `决策节点 ${n.id} 分支数 < 2`, { nodeId: n.id }));
      }
    }

    // 6. 从 start 的可达性(BFS)
    const starts = nodes.filter((n) => n.type === 'start');
    if (starts.length > 0) {
      const reachable = new Set<string>();
      const queue: string[] = [starts[0].id];
      reachable.add(starts[0].id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const e of edges) {
          if (e.source === cur && !reachable.has(e.target)) {
            reachable.add(e.target);
            queue.push(e.target);
          }
        }
      }
      for (const n of nodes) {
        if (!reachable.has(n.id)) {
          issues.push(errorIssue('UNREACHABLE_NODE', `节点 ${n.id} 从 start 不可达`, { nodeId: n.id }));
        }
      }
    }

    // 7. 环检测(Task 9.1)
    issues.push(...this.detectCycles(nodes.map((n) => n.id), edges));

    // valid 只看 error 级:warning(回环)不阻断产出
    return { valid: issues.every((i) => i.severity === 'warning'), issues };
  }

  /**
   * DFS 三色染色法环检测(Task 9.1)
   *   white(未访问) / gray(在当前 DFS 栈中) / black(已完成)
   *   遇到 gray 节点 = 发现后向边 = 存在环,回溯 gray 段得到环路径。
   *
   * ⚠️ 为什么 severity 是 warning 而不是 error:
   *   审批类流程图里「不通过 → 退回上一环节重新提交」是业务上完全合法的回环形态,
   *   内置模板(leave-approval / expense-reimbursement)本身就带这种回环。
   *   把环判为 error 会让合法流程反复触发 Rewriter 直至超限,反而降低可用性。
   *   因此这里只提示:环路径写入 detail,交给上层展示/让模型自查是否为误连。
   */
  private detectCycles(
    nodeIds: string[],
    edges: Array<{ id: string; source: string; target: string; label?: string }>,
  ): GraphIssue[] {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    // 邻接表(忽略引用不存在节点的边,那些已由 EDGE_REFERENCES_MISSING_NODE 报告)
    const idSet = new Set(nodeIds);
    const adj = new Map<string, string[]>();
    nodeIds.forEach((id) => adj.set(id, []));
    for (const e of edges) {
      if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
      adj.get(e.source)!.push(e.target);
    }

    const color = new Map<string, number>();
    nodeIds.forEach((id) => color.set(id, WHITE));

    const issues: GraphIssue[] = [];
    const reported = new Set<string>();
    const stack: string[] = [];

    const dfs = (node: string): void => {
      color.set(node, GRAY);
      stack.push(node);
      for (const next of adj.get(node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          // 回溯 gray 段:从 next 在栈中的位置到栈顶,即为环路径
          const startIdx = stack.indexOf(next);
          const cycle = startIdx >= 0 ? stack.slice(startIdx) : [next, node];
          const key = [...cycle].sort().join('>');
          if (!reported.has(key)) {
            reported.add(key);
            issues.push(
              warningIssue('HAS_CYCLE', `检测到回环(合法审批退回形态,仅提示): ${[...cycle, next].join(' → ')}`, {
                nodeId: next,
                detail: [...cycle, next],
              }),
            );
          }
        } else if (c === WHITE) {
          dfs(next);
        }
      }
      stack.pop();
      color.set(node, BLACK);
    };

    for (const id of nodeIds) {
      if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
    }

    return issues;
  }
}
