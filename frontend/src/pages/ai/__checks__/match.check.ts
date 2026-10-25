// 语图技术方案 - Task 3（match 层）可执行断言脚本
// 覆盖：置信度常量与 confidenceFor / 画布快照与 graph.toJSON 回读 /
//      节点与边的四级降级匹配（L1 id → L2 语义 → L3 拓扑 → L4 兜底 → none 残差）/
//      应用计划编译（默认勾选、歧义、幂等、批次内前向引用、未知 op）/
//      7 种 PatchOperation 执行、选择性应用、歧义裁决、残差上报、纯函数不改入参。
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/match.check.ts

import { autoLayout } from '../layout/auto-layout';
import {
  MATCH_CONFIDENCE,
  MATCH_LEVEL_LABEL,
  MATCH_LEVELS,
  cloneSnapshot,
  confidenceFor,
  emptySnapshot,
  snapshotFromGraphJSON,
  snapshotToPlacedRefs,
} from '../match/match-level';
import type { CanvasSnapshot, SnapshotNode } from '../match/match-level';
import {
  TOPOLOGY_MATCH_THRESHOLD,
  findNodeById,
  findNodeIdsByLabel,
  matchEdge,
  matchNode,
  noneMatch,
  signatureSimilarity,
  topologySignature,
} from '../match/matcher';
import { applyOperations, buildApplyPlan } from '../match/apply-operations';
import { flowDraftToX6 } from '../transform/to-x6';
import type { FlowDraft, NodeType, PatchOperation } from '../transform/types';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
  at,
  describe,
  finish,
  it,
} from './check-util';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/**
 * 主快照：开始 → 提交申请 →（提交）审批 →（通过）结束 → 归档，另有 提交申请 → 归档 旁路。
 * 每个用例都用新对象，避免就地修改串扰。
 */
function makeSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      { id: 's', label: '开始', type: 'start', x: 260, y: 60, width: 120, height: 50 },
      { id: 'a', label: '提交申请', type: 'process', x: 250, y: 220, width: 140, height: 50 },
      { id: 'b', label: '审批', type: 'decision', x: 250, y: 380, width: 140, height: 80 },
      { id: 'c', label: '结束', type: 'end', x: 260, y: 570, width: 120, height: 50 },
      { id: 'd', label: '归档', type: 'process', x: 460, y: 570, width: 140, height: 50 },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'a' },
      { id: 'e2', source: 'a', target: 'b', label: '提交' },
      { id: 'e3', source: 'b', target: 'c', label: '通过' },
      { id: 'e4', source: 'c', target: 'd' },
      { id: 'e5', source: 'a', target: 'd' },
    ],
  };
}

/** 同名歧义快照：两个「审批」（decision / process），用于 L2 歧义与 hint 消歧 */
function makeAmbiguousSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      { id: 'b1', label: '审批', type: 'decision', x: 60, y: 60, width: 140, height: 80 },
      { id: 'b2', label: ' 审批 ', type: 'process', x: 60, y: 300, width: 140, height: 50 },
    ],
    edges: [],
  };
}

/** 边歧义快照：同端点多条边 + 同标签多条边 */
function makeEdgeAmbiguousSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      { id: 's', label: '开始', type: 'start', x: 60, y: 60, width: 120, height: 50 },
      { id: 'a', label: '提交申请', type: 'process', x: 60, y: 220, width: 140, height: 50 },
      { id: 'b', label: '审批', type: 'decision', x: 60, y: 380, width: 140, height: 80 },
    ],
    edges: [
      { id: 'f1', source: 's', target: 'a' },
      { id: 'f2', source: 'a', target: 'b', label: '提交' },
      { id: 'f3', source: 'a', target: 'b', label: '提交' },
    ],
  };
}

function nodeOf(snapshot: CanvasSnapshot, id: string): SnapshotNode | undefined {
  return snapshot.nodes.find((node) => node.id === id);
}

// ---------------------------------------------------------------------------
// match-level
// ---------------------------------------------------------------------------

describe('match-level：等级、置信度与画布快照', () => {
  it('等级枚举顺序即降级顺序，文案齐备', () => {
    assertDeepEqual(MATCH_LEVELS, ['L1', 'L2', 'L3', 'L4', 'none'], 'MATCH_LEVELS 应为降级顺序');
    MATCH_LEVELS.forEach((level) => {
      assertTrue((MATCH_LEVEL_LABEL[level] ?? '').length > 0, `${level} 应有中文说明`);
    });
  });

  it('置信度符合约定：L1=1.0 / L2=0.9|0.5 / L3=0.75|0.4 / L4=0.3 / none=0', () => {
    assertEqual(MATCH_CONFIDENCE.L1, 1.0, 'L1 应为 1.0');
    assertEqual(MATCH_CONFIDENCE.L2_UNIQUE, 0.9, 'L2 唯一应为 0.9');
    assertEqual(MATCH_CONFIDENCE.L2_AMBIGUOUS, 0.5, 'L2 歧义应为 0.5');
    assertEqual(MATCH_CONFIDENCE.L3_UNIQUE, 0.75, 'L3 唯一应为 0.75');
    assertEqual(MATCH_CONFIDENCE.L3_AMBIGUOUS, 0.4, 'L3 歧义应为 0.4');
    assertEqual(MATCH_CONFIDENCE.L4, 0.3, 'L4 应为 0.3');
    assertEqual(MATCH_CONFIDENCE.NONE, 0, 'none 应为 0');
    assertEqual(confidenceFor('L1'), 1.0, 'confidenceFor(L1)');
    assertEqual(confidenceFor('L2'), 0.9, 'confidenceFor(L2) 默认唯一');
    assertEqual(confidenceFor('L2', true), 0.5, 'confidenceFor(L2, 歧义)');
    assertEqual(confidenceFor('L3'), 0.75, 'confidenceFor(L3) 默认唯一');
    assertEqual(confidenceFor('L3', true), 0.4, 'confidenceFor(L3, 歧义)');
    assertEqual(confidenceFor('L4', true), 0.3, 'L4 不区分歧义');
    assertEqual(confidenceFor('none'), 0, 'confidenceFor(none)');
  });

  it('emptySnapshot / cloneSnapshot：深拷贝，改副本不污染原快照', () => {
    assertDeepEqual(emptySnapshot(), { nodes: [], edges: [] }, 'emptySnapshot 结构错误');
    assertDeepEqual(cloneSnapshot(undefined), { nodes: [], edges: [] }, 'null 安全');
    const origin = makeSnapshot();
    const before = JSON.stringify(origin);
    const copy = cloneSnapshot(origin);
    assertDeepEqual(copy, origin, '拷贝应与原快照等价');
    at(copy.nodes, 0, 'node').label = '被改掉';
    copy.edges.push({ id: 'e9', source: 's', target: 'd' });
    assertEqual(JSON.stringify(origin), before, '**cloneSnapshot 必须与原对象完全隔离**');
  });

  it('snapshotFromGraphJSON：flowDraftToX6 输出可直接回读（渲染 → 匹配闭环）', () => {
    const draft: FlowDraft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '提交申请', type: 'process' },
        { id: 'n3', label: '是否通过', type: 'decision' },
        { id: 'n4', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'g1', source: 'n1', target: 'n2' },
        { id: 'g2', source: 'n2', target: 'n3', label: '提交' },
        { id: 'g3', source: 'n3', target: 'n4', label: '通过' },
      ],
    };
    const layout = autoLayout(draft.nodes, draft.edges);
    const x6 = flowDraftToX6(draft, { positions: layout.positions });
    const snapshot = snapshotFromGraphJSON(x6);
    assertEqual(snapshot.nodes.length, 4, '应回读 4 个节点');
    assertEqual(snapshot.edges.length, 3, '应回读 3 条边');
    assertEqual(nodeOf(snapshot, 'n3')?.label, '是否通过', 'label 应从 data 回读');
    assertEqual(nodeOf(snapshot, 'n3')?.type, 'decision', 'type 应从 data.nodeType 回读');
    assertDeepEqual(
      { x: nodeOf(snapshot, 'n2')?.x, y: nodeOf(snapshot, 'n2')?.y },
      layout.positions.n2,
      '坐标应与布局结果一致',
    );
    assertDeepEqual(
      { width: nodeOf(snapshot, 'n3')?.width, height: nodeOf(snapshot, 'n3')?.height },
      { width: 140, height: 80 },
      'decision 尺寸应为 140×80',
    );
    assertEqual(snapshot.edges.find((edge) => edge.id === 'g2')?.label, '提交', '边标签应回读');
    assertEqual(snapshot.edges.find((edge) => edge.id === 'g3')?.source, 'n3', '边源端应回读');
    // 回读快照可直接喂给匹配层
    assertEqual(matchNode({ type: 'node', oldLabel: '是否通过' }, snapshot).id, 'n3', '回读快照应可被 L2 命中');
  });

  it('snapshotFromGraphJSON：cells 形式、手绘节点降级、悬空边丢弃、null 安全', () => {
    assertDeepEqual(snapshotFromGraphJSON(undefined), { nodes: [], edges: [] }, 'undefined 应返回空快照');
    assertDeepEqual(snapshotFromGraphJSON({}), { nodes: [], edges: [] }, '空对象应返回空快照');
    const snapshot = snapshotFromGraphJSON({
      cells: [
        // AI 节点：data 齐备
        { id: 'p1', shape: 'rect', x: 100, y: 100, width: 140, height: 50, data: { nodeType: 'process', label: '起草', degraded: false } },
        // 手绘节点：只有 attrs.label.text 与非法 shape → 降级 process
        { id: 'p2', shape: 'ellipse', x: 100, y: 260, attrs: { label: { text: '复核' } } },
        // 缺 id → 生成 canvas-node-*
        { shape: 'rect', x: 100, y: 420, attrs: { label: { text: '缺 ID' } } },
        // 边：字符串端点
        { id: 'k1', shape: 'edge', source: 'p1', target: 'p2' },
        // 边：{cell,port} 端点 + labels
        { id: 'k2', shape: 'edge', source: { cell: 'p2', port: 'bottom' }, target: { cell: 'p1', port: 'top' }, labels: [{ attrs: { label: { text: '退回' } } }] },
        // 悬空边：端点不存在 → 丢弃
        { id: 'k3', shape: 'edge', source: 'p1', target: 'ghost' },
      ],
    });
    assertEqual(snapshot.nodes.length, 3, '应回读 3 个节点');
    assertEqual(nodeOf(snapshot, 'p2')?.label, '复核', '手绘节点应从 attrs.label.text 回读');
    assertEqual(nodeOf(snapshot, 'p2')?.type, 'process', '非法 shape 应降级为 process');
    assertDeepEqual(
      { width: nodeOf(snapshot, 'p2')?.width, height: nodeOf(snapshot, 'p2')?.height },
      { width: 140, height: 50 },
      '缺尺寸应按类型推算',
    );
    assertTrue(
      snapshot.nodes.some((node) => node.id.indexOf('canvas-node-') === 0 && node.label === '缺 ID'),
      '缺 id 节点应生成兜底 id',
    );
    assertEqual(snapshot.edges.length, 2, '悬空边应被丢弃');
    assertEqual(snapshot.edges.find((edge) => edge.id === 'k2')?.label, '退回', '边标签应从 labels[0] 回读');
    assertEqual(snapshot.edges.find((edge) => edge.id === 'k2')?.target, 'p1', '{cell,port} 端点应归一化');
  });

  it('snapshotToPlacedRefs：供布局层碰撞检测复用', () => {
    const refs = snapshotToPlacedRefs(makeSnapshot());
    assertEqual(refs.length, 5, '应输出全部节点');
    assertDeepEqual(
      at(refs, 2, 'b'),
      { id: 'b', label: '审批', type: 'decision', x: 250, y: 380, width: 140, height: 80 },
      'PlacedNodeRef 字段应完整',
    );
  });
});

// ---------------------------------------------------------------------------
// matcher：节点
// ---------------------------------------------------------------------------

describe('matcher：节点四级降级匹配', () => {
  it('基础设施：阈值、noneMatch、按 label / id 检索', () => {
    assertEqual(TOPOLOGY_MATCH_THRESHOLD, 0.5, 'L3 阈值应为 0.5');
    const none = noneMatch('自定义原因');
    assertDeepEqual(
      { level: none.level, confidence: none.confidence, candidates: none.candidates, ambiguous: none.ambiguous, id: none.id },
      { level: 'none', confidence: 0, candidates: [], ambiguous: false, id: undefined },
      'noneMatch 结构错误',
    );
    assertEqual(none.reason, '自定义原因', 'noneMatch 应保留原因');

    const snapshot = makeSnapshot();
    assertDeepEqual(findNodeIdsByLabel('提交申请', snapshot), ['a'], 'label 检索应唯一命中');
    assertDeepEqual(findNodeIdsByLabel(' 提交 申请 ', snapshot), ['a'], 'label 检索应归一化空白');
    assertDeepEqual(findNodeIdsByLabel('', snapshot), [], '空标签不应命中任何节点');
    assertDeepEqual(findNodeIdsByLabel(undefined, snapshot), [], '非字符串标签不应命中');
    assertDeepEqual(findNodeIdsByLabel('审批', makeAmbiguousSnapshot()), ['b1', 'b2'], '同名应返回全部候选');
    assertEqual(findNodeById('b', snapshot)?.label, '审批', 'findNodeById 应命中');
    assertEqual(findNodeById('', snapshot), undefined, '空 id 应返回 undefined');
    assertEqual(findNodeById(123, snapshot), undefined, '非字符串 id 应返回 undefined');
  });

  it('L1：target.id / target.oldId 精确命中，置信度 1.0', () => {
    const snapshot = makeSnapshot();
    const byId = matchNode({ type: 'node', id: 'b', oldLabel: '完全不对的标签' }, snapshot);
    assertEqual(byId.level, 'L1', 'id 应优先于 label');
    assertEqual(byId.confidence, 1.0, 'L1 置信度应为 1.0');
    assertEqual(byId.id, 'b', 'L1 应给出唯一 id');
    assertDeepEqual(byId.candidates, ['b'], 'L1 候选应只有 1 个');
    assertFalse(byId.ambiguous, 'L1 不应歧义');

    const byOldId = matchNode({ type: 'node', oldId: 'd' }, snapshot);
    assertEqual(byOldId.level, 'L1', 'oldId 同样走 L1');
    assertEqual(byOldId.id, 'd', 'oldId 应命中 d');

    const miss = matchNode({ type: 'node', id: 'ghost', oldLabel: '审批' }, snapshot);
    assertEqual(miss.level, 'L2', 'id 未命中应继续降级到 L2');
    assertEqual(miss.id, 'b', '降级后应按标签命中');
  });

  it('L2：标签唯一命中 0.9；多候选 0.5 且 ambiguous；hint.type 可消歧', () => {
    const snapshot = makeSnapshot();
    const unique = matchNode({ type: 'node', oldLabel: '提交申请' }, snapshot);
    assertEqual(unique.level, 'L2', '应为 L2');
    assertEqual(unique.confidence, 0.9, 'L2 唯一命中应为 0.9');
    assertEqual(unique.id, 'a', '应命中 a');
    assertFalse(unique.ambiguous, '唯一命中不应歧义');
    assertTrue(unique.reason.indexOf('唯一命中') >= 0, 'reason 应说明唯一命中');

    // 归一化：全角空格 / 大小写 / 标点差异
    assertEqual(matchNode({ type: 'node', oldLabel: '　提交申请　' }, snapshot).id, 'a', '应忽略全角空白');

    const ambiguous = matchNode({ type: 'node', oldLabel: '审批' }, makeAmbiguousSnapshot());
    assertEqual(ambiguous.level, 'L2', '同名应为 L2');
    assertEqual(ambiguous.confidence, 0.5, 'L2 多候选应为 0.5');
    assertTrue(ambiguous.ambiguous, '多候选必须标记歧义（交人工确认）');
    assertEqual(ambiguous.id, undefined, '歧义时不应擅自选定 id');
    assertDeepEqual(ambiguous.candidates, ['b1', 'b2'], '应给出全部候选');
    assertTrue(ambiguous.reason.indexOf('需人工确认') >= 0, 'reason 应提示人工确认');

    const hinted = matchNode({ type: 'node', oldLabel: '审批' }, makeAmbiguousSnapshot(), { type: 'decision' });
    assertEqual(hinted.confidence, 0.9, 'hint.type 消歧后应升为唯一命中 0.9');
    assertEqual(hinted.id, 'b1', 'hint.type 应选中 decision 节点');
    assertFalse(hinted.ambiguous, '消歧后不应再歧义');

    const wrongHint = matchNode({ type: 'node', oldLabel: '审批' }, makeAmbiguousSnapshot(), { type: 'end' });
    assertEqual(wrongHint.candidates.length, 2, 'hint.type 无匹配时应保留原候选，绝不臆测');
    assertTrue(wrongHint.ambiguous, '仍应歧义');
  });

  it('L3：前后继拓扑签名，唯一 0.75 / 并列 0.4', () => {
    const snapshot = makeSnapshot();
    assertDeepEqual(topologySignature('a', snapshot), { preds: ['开始'], succs: ['审批', '归档'] }, '拓扑签名错误');
    assertEqual(signatureSimilarity({ preds: ['开始'], succs: [] }, { preds: ['开始'], succs: [] }), 1, '完全一致应为 1');
    assertEqual(signatureSimilarity({ preds: [], succs: [] }, { preds: ['开始'], succs: [] }), 0, '无期望信息应为 0');
    assertEqual(
      signatureSimilarity({ preds: ['开始'], succs: ['审批'] }, topologySignature('a', snapshot)),
      1,
      '相似度按「期望项召回率」计：期望的前驱/后继全部命中即为 1',
    );
    assertEqual(
      signatureSimilarity({ preds: ['开始'], succs: ['不存在'] }, topologySignature('a', snapshot)),
      0.5,
      '期望项半命中应为 0.5',
    );

    // 标签对不上，但拓扑签名唯一命中 a
    const unique = matchNode({ type: 'node', oldLabel: '模型改过的名字' }, snapshot, {
      predecessors: ['开始'],
      successors: ['审批'],
    });
    assertEqual(unique.level, 'L3', '应降级到 L3');
    assertEqual(unique.confidence, 0.75, 'L3 唯一应为 0.75');
    assertEqual(unique.id, 'a', '应按拓扑命中 a');
    assertFalse(unique.ambiguous, '唯一命中不应歧义');

    // 仅给后继「归档」→ a 与 c 并列
    const tied = matchNode({ type: 'node' }, snapshot, { successors: ['归档'] });
    assertEqual(tied.level, 'L3', '并列也属 L3');
    assertEqual(tied.confidence, 0.4, 'L3 多候选应为 0.4');
    assertTrue(tied.ambiguous, '并列必须歧义');
    assertDeepEqual(tied.candidates, ['a', 'c'], '并列候选应为 a 与 c');
  });

  it('L4：部分命中 0.3，必须人工确认', () => {
    const snapshot = makeSnapshot();
    // 标签包含关系（「提交」⊂「提交申请」）
    const partialLabel = matchNode({ type: 'node', oldLabel: '提交' }, snapshot);
    assertEqual(partialLabel.level, 'L4', '标签部分命中应降到 L4');
    assertEqual(partialLabel.confidence, 0.3, 'L4 应为 0.3');
    assertDeepEqual(partialLabel.candidates, ['a'], 'L4 应给出候选供人工确认');
    assertTrue(partialLabel.ambiguous, 'L4 一律需人工确认');
    assertEqual(partialLabel.id, undefined, 'L4 不应自动选定');

    // 拓扑相似度不足阈值（>0 但 <0.5）
    const partialTopo = matchNode({ type: 'node' }, snapshot, {
      predecessors: ['开始'],
      successors: ['不存在甲', '不存在乙'],
    });
    assertEqual(partialTopo.level, 'L4', '相似度不足阈值应降到 L4');
    assertEqual(partialTopo.confidence, 0.3, 'L4 应为 0.3');
    assertDeepEqual(partialTopo.candidates, ['a'], '应给出最接近的候选');
    assertFalse(partialTopo.ambiguous, '拓扑兜底唯一候选时不标记歧义，但仍需确认');
    assertTrue(partialTopo.reason.indexOf('相似度') >= 0, 'reason 应带相似度');
  });

  it('none：未匹配一律显式上报为残差，绝不猜测', () => {
    const snapshot = makeSnapshot();
    const missing = matchNode({ type: 'node', oldLabel: '画布上根本没有的节点' }, snapshot);
    assertEqual(missing.level, 'none', '应为 none');
    assertEqual(missing.confidence, 0, 'none 置信度为 0');
    assertDeepEqual(missing.candidates, [], 'none 不应给候选');
    assertEqual(missing.id, undefined, 'none 不应给 id');
    assertTrue(missing.reason.indexOf('找不到') >= 0, 'reason 应说明找不到');

    assertEqual(matchNode(undefined, snapshot).level, 'none', '缺 target 应为 none');
    assertEqual(matchNode({ type: 'node', oldLabel: '审批' }, emptySnapshot()).reason, '画布为空', '空画布应直接 none');
    assertEqual(matchNode({ type: 'node' }, snapshot).level, 'none', '既无 id 也无 label 应为 none');
  });
});

// ---------------------------------------------------------------------------
// matcher：边
// ---------------------------------------------------------------------------

describe('matcher：边四级降级匹配', () => {
  it('L1 / L2：边 id 精确命中，边标签唯一 0.9、多条 0.5', () => {
    const snapshot = makeSnapshot();
    const byId = matchEdge({ type: 'edge', id: 'e3' }, snapshot);
    assertEqual(byId.level, 'L1', 'id 应走 L1');
    assertEqual(byId.confidence, 1.0, 'L1 应为 1.0');
    assertEqual(byId.id, 'e3', '应命中 e3');
    assertEqual(matchEdge({ type: 'edge', oldId: 'e5' }, snapshot).id, 'e5', 'oldId 同样走 L1');

    const byLabel = matchEdge({ type: 'edge', oldLabel: '提交' }, snapshot);
    assertEqual(byLabel.level, 'L2', '边标签唯一应为 L2');
    assertEqual(byLabel.confidence, 0.9, 'L2 唯一应为 0.9');
    assertEqual(byLabel.id, 'e2', '应命中 e2');

    const ambiguous = matchEdge({ type: 'edge', oldLabel: '提交' }, makeEdgeAmbiguousSnapshot());
    assertEqual(ambiguous.level, 'L2', '同标签多条仍属 L2');
    assertEqual(ambiguous.confidence, 0.5, 'L2 多候选应为 0.5');
    assertDeepEqual(ambiguous.candidates, ['f2', 'f3'], '应给出全部候选');
    assertTrue(ambiguous.ambiguous, '必须标记歧义');
  });

  it('L3：端点标签唯一确定一条边 0.75；多条 0.4', () => {
    const snapshot = makeSnapshot();
    const unique = matchEdge({ type: 'edge', source: '开始', target: '提交申请' }, snapshot);
    assertEqual(unique.level, 'L3', '端点唯一应为 L3');
    assertEqual(unique.confidence, 0.75, 'L3 唯一应为 0.75');
    assertEqual(unique.id, 'e1', '应命中 e1');
    assertFalse(unique.ambiguous, '唯一不应歧义');

    const tied = matchEdge({ type: 'edge', source: '提交申请', target: '审批' }, makeEdgeAmbiguousSnapshot());
    assertEqual(tied.confidence, 0.4, '端点命中多条应为 0.4');
    assertTrue(tied.ambiguous, '多条必须歧义');
    assertEqual(tied.candidates.length, 2, '应给出 2 个候选');
  });

  it('L4：仅单端命中 0.3；端点部分命中但画布无边时给空候选', () => {
    const snapshot = makeSnapshot();
    const oneEnd = matchEdge({ type: 'edge', source: '开始', target: '不存在的节点' }, snapshot);
    assertEqual(oneEnd.level, 'L4', '单端命中应降到 L4');
    assertEqual(oneEnd.confidence, 0.3, 'L4 应为 0.3');
    assertDeepEqual(oneEnd.candidates, ['e1'], '应列出源端相连的边供确认');
    assertTrue(oneEnd.ambiguous, 'L4 需人工确认');

    // 归档（d）没有出边 → 候选为空但仍属 L4
    const noEdge = matchEdge({ type: 'edge', source: '归档', target: '不存在' }, snapshot);
    assertEqual(noEdge.level, 'L4', '仍应给出 L4 兜底');
    assertDeepEqual(noEdge.candidates, [], '画布无对应边时候选为空');
    assertFalse(noEdge.ambiguous, '无候选时无从歧义');
    assertEqual(noEdge.id, undefined, '不应选定 id');
  });

  it('none：无边 / 缺 target / 完全对不上', () => {
    assertEqual(matchEdge(undefined, makeSnapshot()).level, 'none', '缺 target 应为 none');
    assertEqual(matchEdge({ type: 'edge', id: 'e1' }, emptySnapshot()).reason, '画布无边', '无边应直接 none');
    const miss = matchEdge({ type: 'edge', source: '甲', target: '乙' }, makeSnapshot());
    assertEqual(miss.level, 'none', '端点与标签全不匹配应为 none');
    assertEqual(miss.confidence, 0, 'none 置信度为 0');
  });
});

// ---------------------------------------------------------------------------
// apply-operations：计划编译
// ---------------------------------------------------------------------------

describe('apply-operations：buildApplyPlan 应用计划', () => {
  it('命中项默认勾选，未匹配项默认不勾选且进 blockedIndexes', () => {
    const operations: PatchOperation[] = [
      { op: 'modify_node', target: { type: 'node', oldLabel: '提交申请' }, semantic: { label: '提交审批' } },
      { op: 'delete_node', target: { type: 'node', oldLabel: '画布上没有的节点' } },
    ];
    const snapshot = makeSnapshot();
    const plan = buildApplyPlan(operations, snapshot);
    assertEqual(plan.items.length, 2, '应编译 2 项');
    assertEqual(plan.snapshot === snapshot, true, 'plan.snapshot 应为调用方快照引用（只读）');

    const first = at(plan.items, 0, 'first');
    assertEqual(first.index, 0, 'index 应与下标一致');
    assertEqual(first.kind, 'modify_node', 'kind 应回传');
    assertEqual(first.level, 'L2', '命中等级应为 L2');
    assertEqual(first.confidence, 0.9, '置信度应为 0.9');
    assertEqual(first.matchedId, 'a', '应记录命中 id');
    assertTrue(first.defaultSelected, '命中且非歧义应默认勾选');
    assertFalse(first.blocked, '命中项不应 blocked');
    assertEqual(first.title, '修改节点 「提交申请」', 'title 文案错误');
    assertEqual(first.detail, '标签 → 提交审批', 'detail 文案错误');

    const second = at(plan.items, 1, 'second');
    assertEqual(second.level, 'none', '未匹配应为 none');
    assertFalse(second.defaultSelected, '未匹配默认不执行');
    assertTrue(second.blocked, '未匹配应 blocked');
    assertTrue(second.reason.indexOf('找不到') >= 0, 'reason 应说明原因');
    assertDeepEqual(plan.selectedIndexes, [0], '默认勾选集合错误');
    assertDeepEqual(plan.blockedIndexes, [1], 'blocked 集合错误');
    assertEqual(JSON.stringify(snapshot.nodes.length), '5', '编译计划不应改动快照');
  });

  it('歧义项：默认不勾选并给出带类型说明的候选', () => {
    const plan = buildApplyPlan(
      [{ op: 'delete_node', target: { type: 'node', oldLabel: '审批' } }],
      makeAmbiguousSnapshot(),
    );
    const item = at(plan.items, 0, 'item');
    assertTrue(item.ambiguous, '应标记歧义');
    assertTrue(item.blocked, '歧义未裁决应 blocked');
    assertFalse(item.defaultSelected, '歧义默认不执行（人在回路）');
    assertEqual(item.confidence, 0.5, 'L2 歧义置信度 0.5');
    assertDeepEqual(
      item.candidates.map((candidate) => candidate.label),
      ['审批（decision）', '审批（process）'],
      '候选文案应带类型便于区分',
    );

    // 裁决后重新编译：解锁并默认勾选
    const resolved = buildApplyPlan(
      [{ op: 'delete_node', target: { type: 'node', oldLabel: '审批' } }],
      makeAmbiguousSnapshot(),
      { 0: 'b2' },
    );
    const resolvedItem = at(resolved.items, 0, 'resolved');
    assertFalse(resolvedItem.blocked, '裁决后应解锁');
    assertTrue(resolvedItem.defaultSelected, '裁决后应默认勾选');
    assertEqual(resolvedItem.matchedId, 'b2', '应采纳用户裁决');
    assertTrue(resolvedItem.reason.indexOf('已人工选定 b2') >= 0, 'reason 应记录裁决');

    // 无效裁决（id 不在候选中）→ 仍 blocked，绝不臆测
    const invalid = buildApplyPlan(
      [{ op: 'delete_node', target: { type: 'node', oldLabel: '审批' } }],
      makeAmbiguousSnapshot(),
      { 0: 'ghost' },
    );
    assertTrue(at(invalid.items, 0, 'invalid').blocked, '无效裁决应仍 blocked');
  });

  it('add_node / add_edge：幂等跳过与批次内前向引用', () => {
    const operations: PatchOperation[] = [
      { op: 'add_node', semantic: { label: '复核', nodeType: 'process' }, position: { relativeTo: { label: '审批' }, direction: 'right' } },
      { op: 'add_edge', semantic: { source: '复核', target: '结束', label: '通过复核' } },
      { op: 'add_node', semantic: { label: '归档', nodeType: 'process' }, position: { relativeTo: { label: '结束' }, direction: 'right' } },
      { op: 'add_edge', semantic: { source: '开始', target: '提交申请' } },
      { op: 'add_edge', semantic: { source: '不存在的甲', target: '不存在的乙' } },
    ];
    const plan = buildApplyPlan(operations, makeSnapshot());

    const addNode = at(plan.items, 0, 'add_node');
    assertFalse(addNode.blocked, '新增节点无需匹配画布');
    assertEqual(addNode.level, 'L1', '新增项按 L1/置信度 1 记');
    assertEqual(addNode.confidence, 1, '新增项置信度应为 1');
    assertTrue(addNode.defaultSelected, '新增项应默认勾选');
    assertEqual(addNode.detail, '类型 process；位于「审批」的右侧', 'detail 应说明类型与相对位置');

    const addEdge = at(plan.items, 1, 'add_edge');
    assertFalse(addEdge.blocked, '**同批次新增的节点应能被后续 add_edge 引用**');
    assertTrue(addEdge.defaultSelected, '前向引用应默认勾选');
    assertEqual(addEdge.detail, '边标签 通过复核', 'detail 应带边标签');

    const dupNode = at(plan.items, 2, 'dup_node');
    assertTrue(dupNode.blocked, '同名节点应幂等跳过');
    assertFalse(dupNode.defaultSelected, '同名节点默认不执行');
    assertTrue(dupNode.reason.indexOf('已存在') >= 0, 'reason 应说明幂等跳过');
    assertEqual(dupNode.level, 'none', '跳过项等级为 none');

    const dupEdge = at(plan.items, 3, 'dup_edge');
    assertTrue(dupEdge.blocked, '同端点边已存在应跳过');
    assertFalse(dupEdge.defaultSelected, '重复边默认不执行');
    assertEqual(dupEdge.skipReason, 'duplicate', '重复边应归类为 duplicate');
    assertTrue(dupEdge.reason.indexOf('已存在') >= 0, '计划阶段即应说明该边已存在（幂等）');
    assertEqual(dupEdge.level, 'none', '跳过项等级为 none');

    const missingEnd = at(plan.items, 4, 'missing_end');
    assertTrue(missingEnd.blocked, '端点缺失应 blocked');
    assertTrue(missingEnd.reason.indexOf('不存在的甲') >= 0, 'reason 应指出缺失端点');
    assertDeepEqual(plan.selectedIndexes, [0, 1], '仅前两项默认执行');
  });

  it('非法类型降级与未知 op：不抛异常、计入 blocked', () => {
    const operations: PatchOperation[] = [
      {
        op: 'add_node',
        semantic: { label: '异常类型', nodeType: 'diamond' as unknown as NodeType },
        position: { relativeTo: { label: '开始' }, direction: 'bottom' },
      },
      { op: 'weird_op' } as unknown as PatchOperation,
      { op: 'add_node', semantic: { label: '', nodeType: 'process' }, position: { relativeTo: { label: '开始' }, direction: 'bottom' } },
    ];
    const plan = buildApplyPlan(operations, makeSnapshot());
    const degraded = at(plan.items, 0, 'degraded');
    assertFalse(degraded.blocked, '非法类型应降级而非阻断');
    assertTrue(degraded.detail.indexOf('已降级为 process') >= 0, 'detail 应提示降级');

    const unknown = at(plan.items, 1, 'unknown');
    assertTrue(unknown.blocked, '未知 op 必须 blocked');
    assertFalse(unknown.defaultSelected, '未知 op 默认不执行');
    assertEqual(unknown.reason, '未知 op 类型，已忽略', 'reason 文案错误');

    const noLabel = at(plan.items, 2, 'no_label');
    assertTrue(noLabel.blocked, '缺 label 的新增应 blocked');
    assertTrue(noLabel.reason.indexOf('缺少 label') >= 0, 'reason 应说明缺少 label');

    assertDeepEqual(buildApplyPlan(undefined, makeSnapshot()).items, [], 'operations 为 undefined 应安全返回空计划');
    assertDeepEqual(buildApplyPlan([], makeSnapshot()).selectedIndexes, [], '空操作应无勾选项');
  });

  it('reposition / modify_edge / delete_edge 计划文案', () => {
    const plan = buildApplyPlan(
      [
        { op: 'reposition', target: { type: 'node', oldLabel: '归档' }, position: { relativeTo: { label: '结束' }, direction: 'right' } },
        { op: 'modify_edge', target: { type: 'edge', oldLabel: '提交' }, semantic: { label: '' }, visual: { borderStyle: 'dotted' } },
        { op: 'delete_edge', target: { type: 'edge', source: '结束', target: '归档' } },
      ],
      makeSnapshot(),
    );
    assertEqual(at(plan.items, 0, 'reposition').detail, '位于「结束」的右侧', 'reposition detail 错误');
    assertEqual(at(plan.items, 0, 'reposition').title, '移动节点 「归档」', 'reposition title 错误');
    assertEqual(at(plan.items, 1, 'modify_edge').detail, '边标签 → （清空）；边框 dotted', '清空标签应显式说明');
    assertEqual(at(plan.items, 2, 'delete_edge').title, '删除边', 'delete_edge title 错误');
    assertTrue(
      at(plan.items, 2, 'delete_edge').candidates.length > 0 || at(plan.items, 2, 'delete_edge').matchedId === 'e4',
      'delete_edge 应给出目标',
    );
    assertEqual(at(plan.items, 2, 'delete_edge').matchedId, 'e4', '端点应唯一命中 e4');
    assertDeepEqual(plan.blockedIndexes, [], '三项均应可执行');
  });
});

// ---------------------------------------------------------------------------
// apply-operations：执行
// ---------------------------------------------------------------------------

describe('apply-operations：applyOperations 执行与残差', () => {
  it('modify_node / modify_edge：语义与视觉合并写入，返回全新快照', () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    const report = applyOperations(snapshot, [
      {
        op: 'modify_node',
        target: { type: 'node', oldLabel: '提交申请' },
        semantic: { label: '提交审批', nodeType: 'process' },
        visual: { borderStyle: 'dashed', fillColor: '#FFF1F0' },
      },
      { op: 'modify_edge', target: { type: 'edge', oldLabel: '提交' }, semantic: { label: '提交审核' }, visual: { borderWidth: 2 } },
      { op: 'modify_edge', target: { type: 'edge', oldLabel: '通过' }, semantic: { label: '' } },
    ]);
    assertEqual(report.appliedCount, 3, '应全部执行');
    assertEqual(report.skippedCount, 0, '不应有跳过');
    assertDeepEqual(report.residual, [], '无残差');
    assertEqual(JSON.stringify(snapshot), before, '**applyOperations 不得修改入参快照**');

    const modified = nodeOf(report.snapshot, 'a');
    assertEqual(modified?.label, '提交审批', 'label 应被修改');
    assertEqual(modified?.type, 'process', 'type 应被修改');
    assertDeepEqual(modified?.visual, { borderStyle: 'dashed', fillColor: '#FFF1F0' }, 'visual 应写入');
    assertEqual(nodeOf(snapshot, 'a')?.label, '提交申请', '原快照节点未被改动');

    const edge2 = report.snapshot.edges.find((edge) => edge.id === 'e2');
    assertEqual(edge2?.label, '提交审核', '边标签应被修改');
    assertDeepEqual(edge2?.visual, { borderWidth: 2 }, '边 visual 应写入');
    assertEqual(report.snapshot.edges.find((edge) => edge.id === 'e3')?.label, undefined, '空字符串应清空边标签');
    assertEqual(at(report.results, 0, 'r0').targetId, 'a', '结果应回传作用元素 id');
    assertEqual(at(report.results, 0, 'r0').level, 'L2', '结果应回传匹配等级');
  });

  it('add_node + add_edge：批次内前向引用生效，既有节点坐标绝不改动', () => {
    const snapshot = makeSnapshot();
    const beforePositions = JSON.stringify(snapshot.nodes.map((node) => [node.id, node.x, node.y]));
    const report = applyOperations(snapshot, [
      { op: 'add_node', semantic: { label: '复核', nodeType: 'process' }, position: { relativeTo: { label: '审批' }, direction: 'right' } },
      { op: 'add_edge', semantic: { source: '复核', target: '结束', label: '通过复核' } },
      { op: 'add_edge', semantic: { source: '审批', target: '复核' } },
    ]);
    assertEqual(report.appliedCount, 3, '三项均应执行');
    assertEqual(report.snapshot.nodes.length, 6, '应新增 1 个节点');
    assertEqual(report.snapshot.edges.length, 7, '应新增 2 条边');

    const created = report.snapshot.nodes.find((node) => node.label === '复核');
    assertEqual(created?.id, 'ai-node-1', '新节点应使用 ai-node-* id');
    assertEqual(created?.type, 'process', '类型应写入');
    assertDeepEqual({ x: created?.x, y: created?.y }, { x: 450, y: 395 }, '落点应为「审批」右侧 nodeGap 处');
    assertTrue(
      at(report.results, 0, 'r0').reason.indexOf('relative') >= 0,
      'reason 应说明定位策略',
    );
    assertEqual(JSON.stringify(report.snapshot.nodes.filter((node) => node.id !== 'ai-node-1').map((node) => [node.id, node.x, node.y])), beforePositions, '**既有节点坐标不得改动**');

    const edgeIds = report.snapshot.edges.filter((edge) => edge.id.indexOf('ai-edge-') === 0).map((edge) => edge.id);
    assertDeepEqual(edgeIds, ['ai-edge-1', 'ai-edge-2'], '新边应使用递增的 ai-edge-* id');
    const forward = report.snapshot.edges.find((edge) => edge.id === 'ai-edge-1');
    assertEqual(forward?.source, 'ai-node-1', '前向引用应连到本批次新增节点');
    assertEqual(forward?.target, 'c', '目标应解析为「结束」');
    assertEqual(forward?.label, '通过复核', '边标签应写入');
  });

  it('delete_node 级联删边；delete_edge 仅删边；reposition 只动自己', () => {
    const delNode = applyOperations(makeSnapshot(), [{ op: 'delete_node', target: { type: 'node', oldLabel: '审批' } }]);
    assertEqual(delNode.appliedCount, 1, '应执行删除');
    assertEqual(delNode.snapshot.nodes.length, 4, '节点应减 1');
    assertEqual(delNode.snapshot.edges.length, 3, '相连的 e2/e3 应级联删除');
    assertFalse(delNode.snapshot.edges.some((edge) => edge.source === 'b' || edge.target === 'b'), '不应残留悬挂边');
    assertTrue(at(delNode.results, 0, 'r0').reason.indexOf('2 条相连边') >= 0, 'reason 应说明级联删除数量');

    const delEdge = applyOperations(makeSnapshot(), [{ op: 'delete_edge', target: { type: 'edge', source: '结束', target: '归档' } }]);
    assertEqual(delEdge.snapshot.edges.length, 4, '应删除 1 条边');
    assertEqual(delEdge.snapshot.nodes.length, 5, '端点节点必须保留');
    assertFalse(delEdge.snapshot.edges.some((edge) => edge.id === 'e4'), 'e4 应被删除');

    const snapshot = makeSnapshot();
    const moved = applyOperations(snapshot, [
      { op: 'reposition', target: { type: 'node', oldLabel: '归档' }, position: { relativeTo: { label: '结束' }, direction: 'right' } },
    ]);
    assertEqual(moved.appliedCount, 1, '应执行移动');
    assertDeepEqual({ x: nodeOf(moved.snapshot, 'd')?.x, y: nodeOf(moved.snapshot, 'd')?.y }, { x: 440, y: 570 }, 'd 应移到「结束」右侧');
    assertDeepEqual({ x: nodeOf(moved.snapshot, 'c')?.x, y: nodeOf(moved.snapshot, 'c')?.y }, { x: 260, y: 570 }, '参照节点不得被推动');
    assertDeepEqual({ x: nodeOf(snapshot, 'd')?.x, y: nodeOf(snapshot, 'd')?.y }, { x: 460, y: 570 }, '入参快照未被修改');
    assertEqual(nodeOf(moved.snapshot, 'd')?.width, 140, '尺寸应保留');
  });

  it('幂等：重复应用同一批操作不产生重复元素', () => {
    const operations: PatchOperation[] = [
      { op: 'add_node', semantic: { label: '复核', nodeType: 'process' }, position: { relativeTo: { label: '审批' }, direction: 'right' } },
      { op: 'add_edge', semantic: { source: '开始', target: '归档' } },
    ];
    const first = applyOperations(makeSnapshot(), operations);
    assertEqual(first.appliedCount, 2, '首次应全部执行');
    const second = applyOperations(first.snapshot, operations);
    assertEqual(second.appliedCount, 0, '重复执行应全部跳过');
    assertEqual(second.skippedCount, 2, '应记为跳过');
    assertDeepEqual(
      second.results.map((result) => result.skip),
      ['duplicate', 'duplicate'],
      '跳过原因应为 duplicate',
    );
    assertEqual(second.snapshot.nodes.length, first.snapshot.nodes.length, '节点数不应增长');
    assertEqual(second.snapshot.edges.length, first.snapshot.edges.length + 0, '边数不应增长');
    assertEqual(second.residual.length, 2, '幂等跳过应计入残差供用户知晓');
  });

  it('selectedIndexes：仅执行勾选项，未勾选项不计入残差', () => {
    const operations: PatchOperation[] = [
      { op: 'modify_node', target: { type: 'node', oldLabel: '提交申请' }, semantic: { label: '提交审批' } },
      { op: 'delete_node', target: { type: 'node', oldLabel: '归档' } },
      { op: 'add_node', semantic: { label: '复核', nodeType: 'process' }, position: { relativeTo: { label: '审批' }, direction: 'right' } },
    ];
    const report = applyOperations(makeSnapshot(), operations, { selectedIndexes: [0, 2] });
    assertEqual(report.appliedCount, 2, '应执行 2 项');
    assertEqual(report.skippedCount, 1, '应跳过 1 项');
    assertEqual(at(report.results, 1, 'r1').skip, 'unselected', '未勾选项 skip 应为 unselected');
    assertDeepEqual(report.residual, [], '**未勾选不属于残差**（用户主动选择）');
    assertEqual(nodeOf(report.snapshot, 'a')?.label, '提交审批', '勾选项应生效');
    assertEqual(nodeOf(report.snapshot, 'd')?.label, '归档', '未勾选的删除不应执行');
    assertEqual(report.snapshot.nodes.length, 6, '仅新增 1 个节点');

    const none = applyOperations(makeSnapshot(), operations, { selectedIndexes: [] });
    assertEqual(none.appliedCount, 0, '全不选应无执行');
    assertEqual(none.skippedCount, 3, '全部记为跳过');
    assertDeepEqual(none.snapshot, makeSnapshot(), '全不选时快照应保持不变');
  });

  it('resolvedAmbiguous：采纳裁决后执行；裁决无效则计入残差', () => {
    const operations: PatchOperation[] = [
      { op: 'modify_node', target: { type: 'node', oldLabel: '审批' }, semantic: { label: '部门审批' } },
    ];
    const snapshot = makeAmbiguousSnapshot();
    const accepted = applyOperations(snapshot, operations, { selectedIndexes: [0], resolvedAmbiguous: { 0: 'b2' } });
    assertEqual(accepted.appliedCount, 1, '裁决后应执行');
    assertEqual(at(accepted.results, 0, 'r0').targetId, 'b2', '应作用于用户选定的节点');
    assertEqual(nodeOf(accepted.snapshot, 'b2')?.label, '部门审批', '选定节点应被修改');
    assertEqual(nodeOf(accepted.snapshot, 'b1')?.label, '审批', '未选定节点必须原样保留');

    const rejected = applyOperations(snapshot, operations, { selectedIndexes: [0] });
    assertEqual(rejected.appliedCount, 0, '未裁决不得执行');
    assertEqual(at(rejected.results, 0, 'r0').skip, 'ambiguous', 'skip 应为 ambiguous');
    assertEqual(rejected.residual.length, 1, '歧义未裁决必须计入残差');
    assertDeepEqual(rejected.snapshot, snapshot, '未裁决时快照不变');

    const invalid = applyOperations(snapshot, operations, { selectedIndexes: [0], resolvedAmbiguous: { 0: 'ghost' } });
    assertEqual(at(invalid.results, 0, 'r0').skip, 'ambiguous', '无效裁决等同未裁决');
    assertEqual(invalid.residual.length, 1, '无效裁决应计入残差');
  });

  it('残差构成：unmatched / ambiguous / duplicate / invalid 显式上报，绝不静默丢弃', () => {
    const operations: PatchOperation[] = [
      { op: 'delete_node', target: { type: 'node', oldLabel: '画布上没有的节点' } }, // unmatched
      { op: 'delete_node', target: { type: 'node', oldLabel: '审批' } }, // ambiguous（歧义快照）
      { op: 'add_node', semantic: { label: '审批', nodeType: 'process' }, position: { relativeTo: { label: '开始' }, direction: 'right' } }, // duplicate
      { op: 'weird_op' } as unknown as PatchOperation, // invalid
      { op: 'modify_node', target: { type: 'node', id: 'b1' }, visual: { borderStyle: 'dashed' } }, // 正常执行（L1 id 命中）
    ];
    const report = applyOperations(makeAmbiguousSnapshot(), operations, {
      selectedIndexes: [0, 1, 2, 3, 4],
    });
    assertEqual(report.appliedCount, 1, '仅最后一项应执行');
    assertEqual(report.skippedCount, 4, '应有 4 项跳过');
    assertDeepEqual(
      report.results.slice(0, 4).map((result) => result.skip),
      ['unmatched', 'ambiguous', 'duplicate', 'invalid'],
      '跳过原因分类错误',
    );
    assertEqual(report.residual.length, 4, '四项均应作为残差上报');
    assertTrue(
      report.residual.every((result) => result.skip !== 'unselected'),
      '残差不应包含用户主动未勾选项',
    );
    assertEqual(nodeOf(report.snapshot, 'b1')?.label, '审批', '未执行的删除不得生效');
    assertEqual(report.snapshot.nodes.length, 2, '同名新增应被幂等跳过，节点数不变');
    assertEqual(at(report.results, 4, 'r4').ok, true, '正常项应执行成功');
  });

  it('边界：空操作 / undefined / 下标越界均安全', () => {
    const snapshot = makeSnapshot();
    assertDeepEqual(applyOperations(snapshot, []).results, [], '空操作应无结果');
    assertEqual(applyOperations(snapshot, undefined).appliedCount, 0, 'undefined 操作应安全');
    assertDeepEqual(applyOperations(snapshot, null).snapshot, snapshot, 'null 操作应返回等价快照');
    assertEqual(applyOperations(emptySnapshot(), [
      { op: 'modify_node', target: { type: 'node', oldLabel: '任意' }, semantic: { label: 'X' } },
    ]).residual.length, 1, '空画布上的修改应作为残差上报');

    // plan 与 operations 长度不一致（下标越界）→ invalid，不抛异常
    const plan = buildApplyPlan([{ op: 'delete_edge', target: { type: 'edge', id: 'e1' } }], snapshot);
    const mismatch = applyOperations(snapshot, [], { plan, selectedIndexes: [0] });
    assertEqual(at(mismatch.results, 0, 'r0').skip, 'invalid', '下标越界应记为 invalid');
    assertTrue(at(mismatch.results, 0, 'r0').reason.indexOf('下标越界') >= 0, 'reason 应说明越界');
  });

  it('应用结果可直接回渲染层：快照 → FlowDraft → X6', () => {
    const report = applyOperations(makeSnapshot(), [
      { op: 'add_node', semantic: { label: '复核', nodeType: 'process' }, position: { relativeTo: { label: '审批' }, direction: 'right' } },
      { op: 'add_edge', semantic: { source: '复核', target: '结束' } },
    ]);
    const draft: FlowDraft = {
      nodes: report.snapshot.nodes.map((node) => ({ id: node.id, label: node.label, type: node.type })),
      edges: report.snapshot.edges.map((edge) =>
        edge.label !== undefined ? { id: edge.id, source: edge.source, target: edge.target, label: edge.label } : { id: edge.id, source: edge.source, target: edge.target },
      ),
    };
    const positions: Record<string, { x: number; y: number }> = {};
    report.snapshot.nodes.forEach((node) => {
      positions[node.id] = { x: node.x, y: node.y };
    });
    const x6 = flowDraftToX6(draft, { positions, origin: 'ai-modify' });
    assertEqual(x6.nodes.length, 6, '应渲染 6 个节点');
    assertEqual(x6.edges.length, 6, '应渲染 6 条边');
    assertDeepEqual(x6.droppedEdges, [], '不应有悬空边');
    const created = x6.nodes.find((node) => node.id === 'ai-node-1');
    assertDeepEqual({ x: created?.x, y: created?.y }, { x: 450, y: 395 }, '新节点应保留应用时的落点');
    assertEqual(created?.data?.origin, 'ai-modify', 'origin 应标记为增量修改');
  });
});

finish('match');
