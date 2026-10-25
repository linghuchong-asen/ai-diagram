// 语图技术方案 - Task 2（layout 层）可执行断言脚本
// 覆盖：拓扑分层（含环图 guard）/ 从上到下排列与间距 / 层内居中 / 确定性 /
//      矩形碰撞判定与「先下后右」避让 / 新节点三级定位（relative → centroid → fallback）/
//      绝不修改既有节点坐标。
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/layout.check.ts

import {
  LEVEL_GAP,
  NODE_GAP,
  PADDING,
  autoLayout,
  computeLevels,
} from '../layout/auto-layout';
import {
  DEFAULT_COLLISION_PADDING,
  DEFAULT_MAX_STEPS,
  DEFAULT_STEP_DX,
  DEFAULT_STEP_DY,
  findFreeSpot,
  findFreeSpotDetailed,
  hasCollision,
  rectCenter,
  rectsOverlap,
  resolveCollisions,
  toRect,
} from '../layout/collision';
import {
  FALLBACK_POINT,
  centroidOfNeighbors,
  findReferenceNode,
  placeNewNode,
  resolveRelativePosition,
  toOccupiedRects,
} from '../layout/place-new-node';
import type { PlacedNodeRef } from '../layout/place-new-node';
import type { Rect } from '../transform/types';
import {
  assertClose,
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
  at,
  describe,
  finish,
  it,
} from './check-util';

describe('auto-layout：拓扑分层', () => {
  const chainNodes = [
    { id: 'a', type: 'start' as const },
    { id: 'b', type: 'process' as const },
    { id: 'c', type: 'decision' as const },
    { id: 'd', type: 'end' as const },
  ];
  const chainEdges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ];

  it('常量符合约定：LEVEL_GAP=110 / NODE_GAP=60 / PADDING=60', () => {
    assertEqual(LEVEL_GAP, 110, 'LEVEL_GAP 应为 110');
    assertEqual(NODE_GAP, 60, 'NODE_GAP 应为 60');
    assertEqual(PADDING, 60, 'PADDING 应为 60');
  });

  it('链式图分层为 0/1/2/3，最长路径深度', () => {
    const { levels, maxLevel } = computeLevels(chainNodes, chainEdges);
    assertDeepEqual(levels, { a: 0, b: 1, c: 2, d: 3 }, '链式图层级错误');
    assertEqual(maxLevel, 3, 'maxLevel 应为 3');
  });

  it('分叉汇聚取最长路径（菱形依赖层级）', () => {
    const { levels } = computeLevels(
      [
        { id: 's', type: 'start' },
        { id: 'x', type: 'process' },
        { id: 'y', type: 'process' },
        { id: 'z', type: 'process' },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'x' },
        { source: 's', target: 'y' },
        { source: 'y', target: 'z' },
        { source: 'x', target: 'e' },
        { source: 'z', target: 'e' },
      ],
    );
    assertEqual(levels.x, 1, 'x 应为 1 层');
    assertEqual(levels.z, 2, 'z 应为 2 层（最长路径 s→y→z）');
    assertEqual(levels.e, 3, 'e 应为 3 层（汇聚取最大）');
  });

  it('环图不死循环：guard 耗尽后收敛且不抛异常', () => {
    const cyclic = [
      { id: 'p', type: 'process' as const },
      { id: 'q', type: 'process' as const },
      { id: 'r', type: 'process' as const },
    ];
    const edges = [
      { source: 'p', target: 'q' },
      { source: 'q', target: 'r' },
      { source: 'r', target: 'p' },
    ];
    const { levels } = computeLevels(cyclic, edges);
    assertEqual(Object.keys(levels).length, 3, '环图应仍有全部节点层级');
    assertTrue(
      Object.keys(levels).every((id) => Number.isFinite(levels[id] ?? Number.NaN)),
      '环图层级必须为有限数',
    );
    // 自环同样安全
    const selfLoop = computeLevels([{ id: 's', type: 'process' }], [{ source: 's', target: 's' }]);
    assertEqual(selfLoop.maxLevel, 0, '自环不应抬升层级');
  });

  it('悬空边被忽略，不影响分层', () => {
    const { levels } = computeLevels([{ id: 'a', type: 'process' }], [{ source: 'a', target: 'ghost' }]);
    assertDeepEqual(levels, { a: 0 }, '悬空边应被忽略');
  });

  it('空输入安全返回', () => {
    const empty = autoLayout([], []);
    assertEqual(empty.maxLevel, 0, '空图 maxLevel 应为 0');
    assertDeepEqual(empty.layers, [], '空图 layers 应为空数组');
    assertDeepEqual(empty.positions, {}, '空图 positions 应为空对象');
    assertEqual(empty.width, PADDING * 2, '空图宽度应为两侧留白');
  });
});

describe('auto-layout：从上到下排列', () => {
  const nodes = [
    { id: 'a', type: 'start' as const },
    { id: 'b', type: 'process' as const },
    { id: 'c', type: 'process' as const },
    { id: 'd', type: 'end' as const },
  ];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
    { source: 'c', target: 'd' },
  ];

  it('层级递增 → y 递增（自上而下），首层 y = PADDING', () => {
    const layout = autoLayout(nodes, edges);
    assertEqual(layout.positions.a?.y, PADDING, '首层 y 应等于 PADDING');
    assertTrue((layout.positions.b?.y ?? 0) > (layout.positions.a?.y ?? 0), 'b 应在 a 下方');
    assertTrue((layout.positions.d?.y ?? 0) > (layout.positions.b?.y ?? 0), 'd 应在 b 下方');
    assertEqual(layout.positions.b?.y, layout.positions.c?.y, '同层节点 y 应相同');
  });

  it('层间距 = 本层节点高度 + LEVEL_GAP（decision 高 80 影响下一层）', () => {
    const diamond = autoLayout(
      [
        { id: 'a', type: 'process' as const },
        { id: 'b', type: 'decision' as const },
        { id: 'c', type: 'process' as const },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    );
    const ya = diamond.positions.a?.y ?? 0;
    const yb = diamond.positions.b?.y ?? 0;
    const yc = diamond.positions.c?.y ?? 0;
    assertEqual(ya, PADDING, 'a 应在首层');
    assertEqual(yb, PADDING + 50 + LEVEL_GAP, 'b 的 y 应为 PADDING + process 高 50 + LEVEL_GAP');
    assertEqual(yc, yb + 80 + LEVEL_GAP, 'c 的 y 应为 b.y + decision 高 80 + LEVEL_GAP');
  });

  it('同层节点水平间距 = NODE_GAP，且每层相对最宽层居中', () => {
    const layout = autoLayout(nodes, edges);
    // 第 1 层 b、c 均为 process(140 宽)，间距 NODE_GAP
    const xb = layout.positions.b?.x ?? 0;
    const xc = layout.positions.c?.x ?? 0;
    assertEqual(xc - xb, 140 + NODE_GAP, '同层相邻节点应相隔 width + NODE_GAP');
    assertTrue(xc > xb, '同层按输入顺序从左到右');
    // a（start 120 宽，独占一层）应相对最宽层水平居中
    const layerWidth = 140 * 2 + NODE_GAP;
    const expectedAx = PADDING + (layerWidth - 120) / 2;
    assertClose(layout.positions.a?.x ?? 0, expectedAx, 'a 应相对最宽层居中', 0.51);
    assertClose(layout.positions.d?.x ?? 0, expectedAx, 'd（end 120 宽）同样应居中', 0.51);
  });

  it('包围盒宽高覆盖全部节点', () => {
    const layout = autoLayout(nodes, edges);
    const bottoms = nodes.map((node) => {
      const pos = at([layout.positions[node.id] ?? { x: 0, y: 0 }], 0, 'pos');
      const height = node.type === 'start' || node.type === 'end' ? 50 : 50;
      return pos.y + height;
    });
    assertTrue(layout.height >= Math.max(...bottoms), 'height 应覆盖最底节点');
    assertTrue(layout.width >= PADDING * 2, 'width 应至少含两侧留白');
  });

  it('确定性：同输入两次布局完全一致；不修改入参', () => {
    const before = JSON.stringify({ nodes, edges });
    const first = autoLayout(nodes, edges);
    const second = autoLayout(nodes, edges);
    assertEqual(JSON.stringify(first), JSON.stringify(second), '布局必须确定性');
    assertEqual(JSON.stringify({ nodes, edges }), before, 'autoLayout 修改了入参');
  });

  it('自定义 levelGap/nodeGap/padding 生效', () => {
    const layout = autoLayout(nodes, edges, { levelGap: 200, nodeGap: 10, padding: 0 });
    assertEqual(layout.positions.a?.y, 0, 'padding=0 时首层 y 应为 0');
    assertEqual(layout.positions.b?.y, 50 + 200, 'levelGap 应生效');
    assertEqual((layout.positions.c?.x ?? 0) - (layout.positions.b?.x ?? 0), 150, 'nodeGap 应生效');
  });

  it('positions 可直接喂给 flowDraftToX6（布局与渲染尺寸同源）', () => {
    const layout = autoLayout(nodes, edges);
    nodes.forEach((node) => {
      const pos = layout.positions[node.id];
      assertTrue(!!pos, `${node.id} 必须有坐标`);
      assertTrue(Number.isInteger(pos?.x ?? 0.5), `${node.id} x 应为整数`);
      assertTrue(Number.isInteger(pos?.y ?? 0.5), `${node.id} y 应为整数`);
    });
    // 布局结果内任意两节点不重叠（padding=0 的严格判定）
    const rects: Rect[] = nodes.map((node) => {
      const pos = layout.positions[node.id] ?? { x: 0, y: 0 };
      const size = node.type === 'start' || node.type === 'end' ? { width: 120, height: 50 } : { width: 140, height: 50 };
      return toRect(pos, size);
    });
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        assertFalse(rectsOverlap(at(rects, i, 'i'), at(rects, j, 'j')), `节点 ${i} 与 ${j} 不应重叠`);
      }
    }
  });
});

describe('collision：矩形碰撞检测与避让', () => {
  it('常量符合约定：dx=180 / dy=100 / maxSteps=200', () => {
    assertEqual(DEFAULT_STEP_DX, 180, 'DEFAULT_STEP_DX 应为 180');
    assertEqual(DEFAULT_STEP_DY, 100, 'DEFAULT_STEP_DY 应为 100');
    assertEqual(DEFAULT_MAX_STEPS, 200, 'DEFAULT_MAX_STEPS 应为 200');
    assertEqual(DEFAULT_COLLISION_PADDING, 10, 'DEFAULT_COLLISION_PADDING 应为 10');
  });

  it('toRect / rectCenter 基础几何', () => {
    const rect = toRect({ x: 10, y: 20 }, { width: 100, height: 40 });
    assertDeepEqual(rect, { x: 10, y: 20, width: 100, height: 40 }, 'toRect 结果错误');
    assertDeepEqual(rectCenter(rect), { x: 60, y: 40 }, 'rectCenter 结果错误');
  });

  it('重叠判定：相交为 true，边相邻为 false（padding=0）', () => {
    const a = toRect({ x: 0, y: 0 }, { width: 100, height: 50 });
    assertTrue(rectsOverlap(a, toRect({ x: 50, y: 20 }, { width: 100, height: 50 })), '部分相交应判定重叠');
    assertFalse(rectsOverlap(a, toRect({ x: 100, y: 0 }, { width: 100, height: 50 })), '边相邻不应判定重叠');
    assertFalse(rectsOverlap(a, toRect({ x: 0, y: 50 }, { width: 100, height: 50 })), '上下相邻不应判定重叠');
    assertFalse(rectsOverlap(a, toRect({ x: 500, y: 500 }, { width: 10, height: 10 })), '远离不应重叠');
    assertTrue(rectsOverlap(a, toRect({ x: 10, y: 10 }, { width: 10, height: 10 })), '包含关系应判定重叠');
  });

  it('padding 扩张：留白内的相邻也算重叠', () => {
    const a = toRect({ x: 0, y: 0 }, { width: 100, height: 50 });
    const near = toRect({ x: 105, y: 0 }, { width: 100, height: 50 });
    assertFalse(rectsOverlap(a, near, 0), 'padding=0 时 5px 间隙不算重叠');
    assertTrue(rectsOverlap(a, near, 10), 'padding=10 时 5px 间隙应算重叠');
    assertTrue(hasCollision(a, [near], 10), 'hasCollision 应带 padding 判定');
    assertFalse(hasCollision(a, [near], 0), 'hasCollision padding=0 应放行');
    assertFalse(hasCollision(a, [], 10), '空占位集合不应碰撞');
  });

  it('hasCollision 跳过同一引用（自身不算碰撞）', () => {
    const a = toRect({ x: 0, y: 0 }, { width: 100, height: 50 });
    assertFalse(hasCollision(a, [a], 10), '同一矩形引用不应判定为碰撞');
  });

  it('findFreeSpot：原位空则 attempts=0；「先下后右」优先向下避让', () => {
    const occupied = [toRect({ x: 0, y: 0 }, { width: 140, height: 50 })];
    const free = findFreeSpotDetailed(toRect({ x: 500, y: 500 }, { width: 140, height: 50 }), occupied);
    assertDeepEqual(free.rect, { x: 500, y: 500, width: 140, height: 50 }, '空位应原位返回');
    assertEqual(free.attempts, 0, '原位即空时 attempts 应为 0');
    assertTrue(free.resolved, '应解析成功');

    // 与 occupied 重叠 → 第一步先试 y+dy
    const report = findFreeSpotDetailed(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), occupied, { padding: 0 });
    assertTrue(report.resolved, '应能找到空位');
    assertEqual(report.rect.x, 0, '优先向下避让，x 不变');
    assertEqual(report.rect.y, DEFAULT_STEP_DY, 'y 应下移一个 dy');
    assertEqual(report.attempts, 1, '第一步即命中，attempts 应为 1');
    assertFalse(hasCollision(report.rect, occupied, 0), '结果不应仍与占位重叠');
  });

  it('findFreeSpot：下方被封堵时同步尝试向右（先下后右、步长同步递增）', () => {
    const occupied = [
      toRect({ x: 0, y: 0 }, { width: 140, height: 50 }),
      toRect({ x: 0, y: DEFAULT_STEP_DY }, { width: 140, height: 50 }),
    ];
    // 第 1 步：向下 (0,100) 被占 → 向右 (180,0) 为空 → 命中
    const report = findFreeSpotDetailed(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), occupied, { padding: 0 });
    assertTrue(report.resolved, '应能找到空位');
    assertDeepEqual(report.rect, { x: DEFAULT_STEP_DX, y: 0, width: 140, height: 50 }, '第 1 步向右应命中');
    assertEqual(report.attempts, 2, '下 + 右共 2 次尝试');

    // 下方与右侧同时被封堵 → 第 2 步向下 (0,200) 命中，验证「向下优先于继续右移」
    const blocked = [...occupied, toRect({ x: DEFAULT_STEP_DX, y: 0 }, { width: 140, height: 50 })];
    const deeper = findFreeSpotDetailed(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), blocked, { padding: 0 });
    assertTrue(deeper.resolved, '应能找到空位');
    assertDeepEqual(deeper.rect, { x: 0, y: DEFAULT_STEP_DY * 2, width: 140, height: 50 }, '第 2 步向下应命中');
    assertEqual(deeper.attempts, 3, '下/右/下共 3 次尝试');

    // 下方连续 3 层全堵，右侧第 1 步即空
    const wall = [0, 1, 2].map((i) => toRect({ x: 0, y: DEFAULT_STEP_DY * i }, { width: 140, height: 50 }));
    const right = findFreeSpotDetailed(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), wall, { padding: 0, dx: 200, dy: 100 });
    assertTrue(right.resolved, '应能找到空位');
    assertEqual(right.rect.x, 200, 'x 应右移一个 dx');
    assertEqual(right.rect.y, 0, '右侧第 1 步即空，y 不变');
    assertEqual(findFreeSpot(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), wall, { padding: 0, dx: 200, dy: 100 }).x, 200, 'findFreeSpot 简化版应一致');
  });

  it('findFreeSpot：达到 maxSteps 仍未避让 → resolved=false（由调用方提示）', () => {
    const wall: Rect[] = [];
    for (let i = 0; i <= 6; i += 1) {
      wall.push(toRect({ x: 0, y: DEFAULT_STEP_DY * i }, { width: 140, height: 50 }));
      wall.push(toRect({ x: DEFAULT_STEP_DX, y: DEFAULT_STEP_DY * i }, { width: 140, height: 50 }));
      wall.push(toRect({ x: DEFAULT_STEP_DX * 2, y: DEFAULT_STEP_DY * i }, { width: 140, height: 50 }));
    }
    const report = findFreeSpotDetailed(toRect({ x: 0, y: 0 }, { width: 140, height: 50 }), wall, { maxSteps: 2, padding: 0 });
    assertFalse(report.resolved, 'maxSteps 用尽应返回 resolved=false');
    assertEqual(report.attempts, 4, 'maxSteps=2 应尝试 2×2=4 次');
  });

  it('resolveCollisions：后落位者避让先落位者，且不修改入参', () => {
    const input: Rect[] = [
      toRect({ x: 0, y: 0 }, { width: 140, height: 50 }),
      toRect({ x: 0, y: 0 }, { width: 140, height: 50 }),
      toRect({ x: 0, y: 0 }, { width: 140, height: 50 }),
    ];
    const before = JSON.stringify(input);
    const placed = resolveCollisions(input, { padding: 0 });
    assertEqual(placed.length, 3, '结果应与输入等长');
    assertDeepEqual(at(placed, 0, 'first'), input[0], '第一个节点不应被移动');
    assertEqual(at(placed, 1, 'second').y, DEFAULT_STEP_DY, '第二个节点应下移避让');
    assertEqual(at(placed, 2, 'third').x, DEFAULT_STEP_DX, '第三个节点下方被占应右移避让');
    assertEqual(at(placed, 2, 'third').y, 0, '第三个节点右移后 y 不变');
    assertEqual(JSON.stringify(input), before, 'resolveCollisions 修改了入参');
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        assertFalse(rectsOverlap(at(placed, i, 'i'), at(placed, j, 'j')), '消解后不应仍有重叠');
      }
    }
  });
});

describe('place-new-node：新节点三级定位', () => {
  const existing: PlacedNodeRef[] = [
    { id: 'n1', label: '开始', type: 'start', x: 200, y: 60 },
    { id: 'n2', label: '提交申请', type: 'process', x: 200, y: 220 },
    { id: 'n3', label: '结束', type: 'end', x: 200, y: 380 },
  ];

  it('常量：兜底落点 (60,60)', () => {
    assertDeepEqual(FALLBACK_POINT, { x: 60, y: 60 }, 'FALLBACK_POINT 应为 (60,60)');
  });

  it('toOccupiedRects：尺寸优先取 width/height，其次按类型，最后 140×50', () => {
    const rects = toOccupiedRects([
      { id: 'a', x: 0, y: 0, width: 10, height: 20 },
      { id: 'b', x: 0, y: 0, type: 'start' },
      { id: 'c', x: 0, y: 0 },
    ]);
    assertDeepEqual(at(rects, 0, 'a'), { x: 0, y: 0, width: 10, height: 20 }, '显式尺寸应优先');
    assertDeepEqual(at(rects, 1, 'b'), { x: 0, y: 0, width: 120, height: 50 }, 'start 应按类型尺寸');
    assertDeepEqual(at(rects, 2, 'c'), { x: 0, y: 0, width: 140, height: 50 }, '缺类型应兜底 140×50');
  });

  it('findReferenceNode：按归一化 label 命中（含全角标点/空格/大小写差异）', () => {
    const hit = findReferenceNode({ relativeTo: { label: ' 提交 申请 ' }, direction: 'right' }, existing);
    assertEqual(hit?.id, 'n2', '应忽略空白命中标签');
    const hit2 = findReferenceNode({ relativeTo: { label: '开始' }, direction: 'bottom' }, existing);
    assertEqual(hit2?.id, 'n1', '应命中开始节点');
    assertEqual(findReferenceNode(undefined, existing), undefined, '无 position 应返回 undefined');
    assertEqual(
      findReferenceNode({ relativeTo: { label: '不存在的节点' }, direction: 'top' }, existing),
      undefined,
      '找不到参照应返回 undefined',
    );
  });

  it('resolveRelativePosition：四向按 nodeGap 外移并居中对齐', () => {
    const ref = toRect({ x: 100, y: 100 }, { width: 140, height: 50 });
    const size = { width: 140, height: 50 };
    assertDeepEqual(
      resolveRelativePosition(ref, 'bottom', size, NODE_GAP),
      { x: 100, y: 100 + 50 + NODE_GAP },
      'bottom 应在参照下方 nodeGap 处',
    );
    assertDeepEqual(
      resolveRelativePosition(ref, 'top', size, NODE_GAP),
      { x: 100, y: 100 - NODE_GAP - 50 },
      'top 应在参照上方 nodeGap 处',
    );
    assertDeepEqual(
      resolveRelativePosition(ref, 'right', size, NODE_GAP),
      { x: 100 + 140 + NODE_GAP, y: 100 },
      'right 应在参照右侧 nodeGap 处',
    );
    assertDeepEqual(
      resolveRelativePosition(ref, 'left', size, NODE_GAP),
      { x: 100 - NODE_GAP - 140, y: 100 },
      'left 应在参照左侧 nodeGap 处',
    );
    // 尺寸不同的新节点仍应与参照居中对齐
    const small = resolveRelativePosition(ref, 'right', { width: 60, height: 30 }, 0);
    assertClose(small.y, rectCenter(ref).y - 15, 'right 方向应垂直居中对齐', 1e-6);
    const below = resolveRelativePosition(ref, 'bottom', { width: 60, height: 30 }, 0);
    assertClose(below.x, rectCenter(ref).x - 30, 'bottom 方向应水平居中对齐', 1e-6);
    // 默认 nodeGap = NODE_GAP
    assertDeepEqual(
      resolveRelativePosition(ref, 'bottom', size),
      resolveRelativePosition(ref, 'bottom', size, NODE_GAP),
      '默认间距应为 NODE_GAP',
    );
  });

  it('placeNewNode：relative 策略（参照 + 方向），坐标取整', () => {
    const placed = placeNewNode({
      type: 'process',
      label: '审批',
      position: { relativeTo: { label: '提交申请' }, direction: 'right' },
      existing,
    });
    assertEqual(placed.strategy, 'relative', '应走 relative 策略');
    assertEqual(placed.referenceId, 'n2', '应记录参照节点 id');
    assertEqual(placed.point.x, 200 + 140 + NODE_GAP, 'x 应为参照右侧 + nodeGap');
    assertEqual(placed.point.y, 220, 'y 应与参照对齐');
    assertEqual(placed.shifted, false, '空位不应触发避让');
    assertTrue(placed.resolved, '应解析成功');
    assertDeepEqual(placed.rect, { x: placed.point.x, y: placed.point.y, width: 140, height: 50 }, 'rect 应与 point/尺寸一致');
  });

  it('placeNewNode：relative 命中重叠位 → 自动避让，既有节点坐标不变', () => {
    const before = JSON.stringify(existing);
    // 向下放在 n2 与 n3 之间（会撞上 n3）
    const placed = placeNewNode({
      type: 'process',
      label: '复核',
      position: { relativeTo: { label: '提交申请' }, direction: 'bottom' },
      existing,
    });
    assertEqual(placed.strategy, 'relative', '应走 relative 策略');
    assertTrue(placed.shifted, '与 n3 重叠应触发避让');
    assertTrue(placed.resolved, '应避让成功');
    assertFalse(
      hasCollision(placed.rect, toOccupiedRects(existing), DEFAULT_COLLISION_PADDING),
      '避让后不应与既有节点重叠',
    );
    assertEqual(JSON.stringify(existing), before, '**绝不修改既有节点坐标**');
  });

  it('placeNewNode：参照找不到 → centroid 策略（相连节点质心）', () => {
    const placed = placeNewNode({
      type: 'process',
      label: '新增',
      position: { relativeTo: { label: '画布上不存在的节点' }, direction: 'right' },
      neighborIds: ['n1', 'n3'],
      existing,
    });
    assertEqual(placed.strategy, 'centroid', '参照缺失应降级为质心');
    assertEqual(placed.referenceId, undefined, '质心策略无参照 id');
    // n1 中心 (260, 85)、n3 中心 (260, 405) → 质心 (260, 245)，新节点左上角 = 质心 - 半宽半高
    const centroid = centroidOfNeighbors(['n1', 'n3'], existing);
    assertDeepEqual(centroid, { x: 260, y: 245 }, '质心计算错误');
    assertEqual(placed.point.y, 245 - 25, 'y 应由质心换算左上角');
    assertTrue(placed.shifted, '质心落在 n2 上应触发避让');
    assertTrue(placed.resolved, '应避让成功');
    assertFalse(hasCollision(placed.rect, toOccupiedRects(existing), DEFAULT_COLLISION_PADDING), '避让后不应重叠');
  });

  it('placeNewNode：无参照无邻居 → fallback (60,60)', () => {
    const far: PlacedNodeRef[] = [{ id: 'f1', label: '远处', type: 'process', x: 900, y: 900 }];
    const placed = placeNewNode({ type: 'process', label: '孤立节点', existing: far });
    assertEqual(placed.strategy, 'fallback', '应走 fallback 策略');
    assertDeepEqual(placed.point, FALLBACK_POINT, 'fallback 落点应为 (60,60)');
    assertEqual(placed.shifted, false, 'fallback 位置为空不应避让');

    // 兜底点被既有节点占据 → 仍走 fallback 策略，但自动避让且绝不移动既有节点
    const before = JSON.stringify(existing);
    const bumped = placeNewNode({ type: 'process', label: '孤立节点', existing });
    assertEqual(bumped.strategy, 'fallback', '兜底点被占仍应记为 fallback 策略');
    assertTrue(bumped.shifted, '兜底点与 n1 相邻（留白内）应触发避让');
    assertTrue(bumped.resolved, '应避让成功');
    assertFalse(
      hasCollision(bumped.rect, toOccupiedRects(existing), DEFAULT_COLLISION_PADDING),
      '避让后不应与既有节点重叠',
    );
    assertEqual(JSON.stringify(existing), before, '**绝不修改既有节点坐标**');
  });

  it('placeNewNode：邻居 id 不存在 → 质心不可用则回退 fallback', () => {
    assertEqual(centroidOfNeighbors([], existing), undefined, '空邻居应返回 undefined');
    assertEqual(centroidOfNeighbors(['ghost'], existing), undefined, '不存在的邻居应返回 undefined');
    assertEqual(centroidOfNeighbors(undefined, existing), undefined, 'undefined 邻居应返回 undefined');
    const placed = placeNewNode({ type: 'start', label: 'X', neighborIds: ['ghost'], existing });
    assertEqual(placed.strategy, 'fallback', '邻居无效应回退 fallback');
  });

  it('placeNewNode：按类型取尺寸（decision 140×80、start 120×50），options 可覆盖', () => {
    const decision = placeNewNode({ type: 'decision', label: 'D', existing: [] });
    assertDeepEqual(decision.rect, { x: 60, y: 60, width: 140, height: 80 }, 'decision 尺寸应为 140×80');
    const start = placeNewNode({ type: 'start', label: 'S', existing: [] });
    assertDeepEqual(start.rect, { x: 60, y: 60, width: 120, height: 50 }, 'start 尺寸应为 120×50');
    const custom = placeNewNode({ type: 'process', label: 'C', existing: [] }, { size: { width: 200, height: 90 } });
    assertDeepEqual(custom.rect, { x: 60, y: 60, width: 200, height: 90 }, 'options.size 应覆盖类型尺寸');
    const tight = placeNewNode(
      { type: 'process', label: 'T', position: { relativeTo: { label: '开始' }, direction: 'right' }, existing },
      { nodeGap: 10, padding: 0 },
    );
    assertEqual(tight.point.x, 200 + 120 + 10, 'options.nodeGap 应生效（参照 start 宽 120）');
    assertEqual(tight.point.y, 60, 'right 方向应与参照同高（等高节点）');
    assertEqual(tight.shifted, false, 'padding=0 时 10px 净距不算碰撞');

    const wide = placeNewNode({
      type: 'process',
      label: 'T',
      position: { relativeTo: { label: '开始' }, direction: 'right' },
      existing,
    });
    assertEqual(wide.point.x, 200 + 120 + NODE_GAP, '默认 nodeGap 应为 NODE_GAP');
    assertEqual(wide.shifted, false, '默认间距不应触发避让');
  });

  it('placeNewNode：空画布不避让；避让失败时 resolved=false 仍返回落点', () => {
    const empty = placeNewNode({ type: 'process', label: 'A', existing: [] });
    assertEqual(empty.shifted, false, '空画布不应避让');
    assertEqual(empty.attempts, 0, '空画布 attempts 应为 0');

    const wall: PlacedNodeRef[] = [];
    for (let i = 0; i <= 3; i += 1) {
      wall.push({ id: `w${i}-a`, x: 60, y: 60 + DEFAULT_STEP_DY * i, width: 140, height: 50 });
      wall.push({ id: `w${i}-b`, x: 60 + DEFAULT_STEP_DX, y: 60 + DEFAULT_STEP_DY * i, width: 140, height: 50 });
    }
    const stuck = placeNewNode({ type: 'process', label: 'B', existing: wall }, { maxSteps: 1 });
    assertFalse(stuck.resolved, 'maxSteps 用尽应 resolved=false');
    assertTrue(stuck.shifted, '应记录已尝试避让');
    assertTrue(Number.isFinite(stuck.point.x) && Number.isFinite(stuck.point.y), '仍必须返回有限落点');
  });
});

finish('layout');
