// 语图技术方案 - Task 1（transform 层）可执行断言脚本
// 覆盖：NODE_TYPE_CONFIG 配色契约 / resolveNodeType 降级 / 端口方向约定 / toX6Node / toX6Edge /
//      flowDraftToX6 脏输入降级 / x6ToFlowDraft 回读往返。
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/transform.check.ts

import {
  NODE_TYPE_CONFIG,
  NODE_TYPE_LABEL,
  buildEdgeAttrs,
  buildNodeAttrs,
  getNodeConfig,
  getNodeSize,
  isNodeType,
  resolveNodeType,
} from '../transform/node-type-config';
import {
  PORT_GROUPS,
  buildPorts,
  getPortsForType,
  isPortAllowed,
  pickSourcePort,
  pickTargetPort,
} from '../transform/port-groups';
import {
  DEFAULT_ORIGIN,
  FALLBACK_GAP_Y,
  flowDraftToX6,
  normalizeFlowDraft,
  toX6Edge,
  toX6Node,
  x6ToFlowDraft,
} from '../transform/to-x6';
import type { FlowDraft, RawFlowDraft, X6GraphJSON } from '../transform/types';
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

/** 后端 NODE_TYPE_META（serverend/src/ai/schemas/node.schema.ts）—— 配色契约必须逐字一致 */
const BACKEND_NODE_TYPE_META: Record<string, { shape: string; fill: string; stroke: string; text: string }> = {
  start: { shape: 'ellipse', fill: '#E6FFE6', stroke: '#52C41A', text: '#389E0D' },
  end: { shape: 'ellipse', fill: '#FFF1F0', stroke: '#FF4D4F', text: '#CF1322' },
  process: { shape: 'rect', fill: '#E6F4FF', stroke: '#1677FF', text: '#0958D9' },
  decision: { shape: 'diamond', fill: '#FFF7E6', stroke: '#FA8C16', text: '#D46B08' },
  io: { shape: 'parallelogram', fill: '#F9F0FF', stroke: '#722ED1', text: '#531DAB' },
  subprocess: { shape: 'double-rect', fill: '#E6FFFB', stroke: '#13C2C2', text: '#08979C' },
};

describe('node-type-config：配色与形状契约', () => {
  it('6 种类型的 fill/stroke/text/semanticShape 与后端 NODE_TYPE_META 完全一致', () => {
    Object.keys(BACKEND_NODE_TYPE_META).forEach((type) => {
      const expected = BACKEND_NODE_TYPE_META[type] as { shape: string; fill: string; stroke: string; text: string };
      const config = NODE_TYPE_CONFIG[type as keyof typeof NODE_TYPE_CONFIG];
      assertTrue(!!config, `${type} 缺少配置`);
      assertEqual(config.fill, expected.fill, `${type} fill 与后端不一致`);
      assertEqual(config.stroke, expected.stroke, `${type} stroke 与后端不一致`);
      assertEqual(config.text, expected.text, `${type} text 与后端不一致`);
      assertEqual(config.semanticShape, expected.shape, `${type} semanticShape 与后端不一致`);
    });
  });

  it('形状与尺寸：start/end 椭圆 120×50、process 圆角矩形 140×50', () => {
    assertEqual(NODE_TYPE_CONFIG.start.shape, 'ellipse', 'start 应为 ellipse');
    assertDeepEqual(getNodeSize('start'), { width: 120, height: 50 }, 'start 尺寸应为 120×50');
    assertDeepEqual(getNodeSize('end'), { width: 120, height: 50 }, 'end 尺寸应为 120×50');
    assertEqual(NODE_TYPE_CONFIG.process.shape, 'rect', 'process 应为 rect');
    assertEqual(NODE_TYPE_CONFIG.process.rx, 6, 'process 圆角应为 6');
    assertDeepEqual(getNodeSize('process'), { width: 140, height: 50 }, 'process 尺寸应为 140×50');
  });

  it('decision 菱形 140×80、io 平行四边形 140×50，refPoints 与尺寸自洽', () => {
    assertEqual(NODE_TYPE_CONFIG.decision.refPoints, '0,40 70,0 140,40 70,80', 'decision refPoints 不符');
    assertDeepEqual(getNodeSize('decision'), { width: 140, height: 80 }, 'decision 尺寸应为 140×80');
    assertEqual(NODE_TYPE_CONFIG.io.refPoints, '20,0 140,0 120,50 0,50', 'io refPoints 不符');
    assertDeepEqual(getNodeSize('io'), { width: 140, height: 50 }, 'io 尺寸应为 140×50');
    // refPoints 的最大坐标必须落在 width/height 内
    ['decision', 'io'].forEach((type) => {
      const config = NODE_TYPE_CONFIG[type as 'decision' | 'io'];
      const points = (config.refPoints ?? '').split(' ').map((pair) => pair.split(',').map(Number));
      const maxX = Math.max(...points.map((p) => at(p, 0, 'x')));
      const maxY = Math.max(...points.map((p) => at(p, 1, 'y')));
      assertEqual(maxX, config.width, `${type} refPoints 最大 x 应等于 width`);
      assertEqual(maxY, config.height, `${type} refPoints 最大 y 应等于 height`);
    });
  });

  it('subprocess 双线框：markup 含 body/inner/label，extraAttrs.inner 描边跟随主体', () => {
    const config = getNodeConfig('subprocess');
    assertDeepEqual(
      (config.markup ?? []).map((item) => item.selector),
      ['body', 'inner', 'label'],
      'subprocess markup 顺序应为 body/inner/label',
    );
    const attrs = buildNodeAttrs('subprocess', { fillColor: '#FF0000' });
    assertEqual(String(attrs.body?.fill), '#FF0000', 'visual.fillColor 未生效');
    // 内框描边跟随 body.stroke（配色不割裂）；填充色不覆盖 inner
    assertEqual(String(attrs.inner?.stroke), String(attrs.body?.stroke), 'inner.stroke 应跟随 body.stroke');
    assertEqual(String(attrs.inner?.fill), 'none', 'inner.fill 应为 none');
    // 常量未被污染（纯函数无副作用）
    assertEqual(
      String(NODE_TYPE_CONFIG.subprocess.extraAttrs?.inner?.stroke),
      '#13C2C2',
      'NODE_TYPE_CONFIG 常量被修改（副作用）',
    );
  });

  it('resolveNodeType：合法类型原样、非法/缺失降级为 process 并带 rawType', () => {
    assertDeepEqual(resolveNodeType('decision'), { type: 'decision', degraded: false }, '合法类型不应降级');
    const bad = resolveNodeType('diamond');
    assertEqual(bad.type, 'process', '非法类型应降级为 process');
    assertEqual(bad.degraded, true, '非法类型 degraded 应为 true');
    assertEqual(bad.rawType, 'diamond', 'rawType 应保留原始输出');
    const missing = resolveNodeType(undefined);
    assertEqual(missing.type, 'process', '缺失类型应降级为 process');
    assertEqual(missing.degraded, true, '缺失类型 degraded 应为 true');
    assertEqual(missing.rawType, undefined, '缺失类型不应有 rawType');
    assertTrue(isNodeType('io'), 'isNodeType("io") 应为 true');
    assertFalse(isNodeType('IO'), 'isNodeType 应大小写敏感');
    assertFalse(isNodeType(3), 'isNodeType(3) 应为 false');
  });

  it('buildNodeAttrs：borderStyle → strokeDasharray 映射，solid 清空虚线', () => {
    assertEqual(String(buildNodeAttrs('process', { borderStyle: 'dashed' }).body?.strokeDasharray), '6 3', 'dashed 映射错误');
    assertEqual(String(buildNodeAttrs('process', { borderStyle: 'dotted' }).body?.strokeDasharray), '2 2', 'dotted 映射错误');
    assertFalse(
      'strokeDasharray' in (buildNodeAttrs('process', { borderStyle: 'solid' }).body ?? {}),
      'solid 不应保留 strokeDasharray',
    );
    const styled = buildNodeAttrs('process', { borderWidth: 3, fontColor: '#111111', fontSize: 18 });
    assertEqual(styled.body?.strokeWidth, 3, 'borderWidth 未生效');
    assertEqual(String(styled.label?.fill), '#111111', 'fontColor 未生效');
    assertEqual(styled.label?.fontSize, 18, 'fontSize 未生效');
    assertEqual(String(buildEdgeAttrs({ borderStyle: 'dashed' }).line?.strokeDasharray), '6 3', '边虚线映射错误');
    assertEqual(String(buildEdgeAttrs().line?.stroke), '#A3B1BF', '边默认描边应为 #A3B1BF');
  });

  it('NODE_TYPE_LABEL 与配置中文标签同源', () => {
    Object.keys(NODE_TYPE_LABEL).forEach((type) => {
      const key = type as keyof typeof NODE_TYPE_LABEL;
      assertEqual(NODE_TYPE_LABEL[key], NODE_TYPE_CONFIG[key].label, `${type} 中文标签不一致`);
    });
    assertEqual(NODE_TYPE_LABEL.decision, '判断', 'decision 中文标签应为「判断」');
  });
});

describe('port-groups：端口方向约定', () => {
  it('start 仅 bottom，end 仅 top，其余四向且顺序稳定', () => {
    assertDeepEqual(getPortsForType('start'), ['bottom'], 'start 应仅暴露 bottom');
    assertDeepEqual(getPortsForType('end'), ['top'], 'end 应仅暴露 top');
    ['process', 'decision', 'io', 'subprocess'].forEach((type) => {
      assertDeepEqual(
        getPortsForType(type as 'process'),
        ['top', 'right', 'bottom', 'left'],
        `${type} 应暴露四向端口`,
      );
    });
  });

  it('PORT_GROUPS 四向定义完整，默认样式 r=3 / magnet / hidden', () => {
    assertDeepEqual(Object.keys(PORT_GROUPS), ['top', 'right', 'bottom', 'left'], '端口组应为四向');
    const circle = PORT_GROUPS.top.attrs.circle;
    assertEqual(circle.r, 3, '端口半径应为 3');
    assertEqual(circle.magnet, true, '端口应为 magnet');
    assertEqual(circle.visibility, 'hidden', '端口默认应隐藏');
    assertEqual(PORT_GROUPS.bottom.position, 'bottom', 'position 应与键名一致');
  });

  it('buildPorts：items 与类型裁剪一致，groups 恒定四向', () => {
    const startPorts = buildPorts('start');
    assertDeepEqual(startPorts.items, [{ id: 'bottom', group: 'bottom' }], 'start items 应只有 bottom');
    assertEqual(Object.keys(startPorts.groups).length, 4, 'groups 应始终四向定义');
    assertEqual(buildPorts('process').items.length, 4, 'process 应有 4 个 item');
    assertTrue(isPortAllowed('start', 'bottom'), 'start 允许 bottom');
    assertFalse(isPortAllowed('start', 'top'), 'start 不允许 top');
    assertFalse(isPortAllowed('end', 'bottom'), 'end 不允许 bottom');
    assertTrue(isPortAllowed('end', 'top'), 'end 允许 top');
  });

  it('pickSourcePort/pickTargetPort：start 出 bottom、end 入 top', () => {
    assertEqual(pickSourcePort('start'), 'bottom', 'start 源端口应为 bottom');
    assertEqual(pickTargetPort('end'), 'top', 'end 目标端口应为 top');
    assertEqual(pickSourcePort('process'), 'bottom', 'process 源端口优先 bottom');
    assertEqual(pickTargetPort('process'), 'top', 'process 目标端口优先 top');
    // start 只有 bottom 一个端口：作为目标端时也只能连 bottom（不返回 undefined，避免边无锚点）
    assertEqual(pickTargetPort('start'), 'bottom', 'start 目标端口应退化为其唯一端口 bottom');
    assertEqual(pickSourcePort('end'), 'top', 'end 源端口应退化为其唯一端口 top');
    assertFalse(isPortAllowed('end', 'bottom'), 'end 不应有 bottom 端口');
  });
});

describe('to-x6：FlowDraft → X6 确定性转换', () => {
  const draft: FlowDraft = {
    nodes: [
      { id: 'n1', label: '开始', type: 'start' },
      { id: 'n2', label: '提交申请', type: 'process' },
      { id: 'n3', label: '是否通过', type: 'decision' },
      { id: 'n4', label: '结束', type: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', label: '提交' },
      { id: 'e3', source: 'n3', target: 'n4', label: '通过' },
    ],
  };

  it('toX6Node：shape/尺寸/attrs/ports/data 全部由类型配置生成', () => {
    const node = toX6Node({ id: 'n3', label: '是否通过', type: 'decision' }, { pos: { x: 100.4, y: 200.6 } });
    assertEqual(node.shape, 'polygon', 'decision 应渲染为 polygon');
    assertEqual(node.width, 140, 'decision 宽应为 140');
    assertEqual(node.height, 80, 'decision 高应为 80');
    assertEqual(node.x, 100, 'x 应四舍五入');
    assertEqual(node.y, 201, 'y 应四舍五入');
    assertEqual(String(node.attrs?.body?.fill), '#FFF7E6', 'decision 填充色错误');
    assertEqual(String(node.attrs?.body?.refPoints), '0,40 70,0 140,40 70,80', 'decision 应带 refPoints');
    assertDeepEqual(node.data, { nodeType: 'decision', label: '是否通过', degraded: false, origin: 'ai-generate' }, 'data 元信息不符');
    assertDeepEqual(
      (node.ports?.items ?? []).map((item) => item.id),
      ['top', 'right', 'bottom', 'left'],
      'decision 端口应为四向',
    );
  });

  it('toX6Node 默认落点为 DEFAULT_ORIGIN，subprocess 附 markup', () => {
    const plain = toX6Node({ id: 'a', label: 'A', type: 'process' });
    assertEqual(plain.x, DEFAULT_ORIGIN.x, '默认 x 应为 DEFAULT_ORIGIN.x');
    assertEqual(plain.y, DEFAULT_ORIGIN.y, '默认 y 应为 DEFAULT_ORIGIN.y');
    assertEqual(plain.markup, undefined, 'process 不应有自定义 markup');
    const sub = toX6Node({ id: 'b', label: 'B', type: 'subprocess' }, { degraded: true, rawType: 'sub' });
    assertEqual((sub.markup ?? []).length, 3, 'subprocess 应有 3 段 markup');
    assertEqual(sub.data?.degraded, true, 'degraded 标记应透传');
    assertEqual(sub.data?.rawType, 'sub', 'rawType 应透传');
  });

  it('toX6Edge：端口按两端类型推导，label 走 position {distance:0.5,offset:0}', () => {
    const edge = toX6Edge({ id: 'e1', source: 'n1', target: 'n4' }, { sourceType: 'start', targetType: 'end' });
    assertEqual(edge.shape, 'edge', 'shape 应为 edge');
    assertDeepEqual(edge.source, { cell: 'n1', port: 'bottom' }, 'start 出桩应为 bottom');
    assertDeepEqual(edge.target, { cell: 'n4', port: 'top' }, 'end 入桩应为 top');
    assertEqual(edge.labels, undefined, '无 label 的边不应生成 labels');
    assertDeepEqual(edge.connector, { name: 'normal' }, 'connector 应对齐既有画布约定');
    assertEqual(String(edge.attrs?.line?.stroke), '#A3B1BF', '边默认描边错误');

    const labeled = toX6Edge(
      { id: 'e2', source: 'n2', target: 'n3', label: '提交' },
      { sourceType: 'process', targetType: 'decision', visual: { borderStyle: 'dashed' } },
    );
    const first = at(labeled.labels ?? [], 0, 'labeled.labels 应有 1 项');
    assertDeepEqual(first.position, { distance: 0.5, offset: 0 }, 'label position 不符约定');
    assertEqual(String(first.attrs?.label?.text), '提交', 'label 文本错误');
    assertEqual(String(labeled.attrs?.line?.strokeDasharray), '6 3', '边 visual 未生效');
    assertEqual(labeled.data?.label, '提交', 'data.label 应回写');
    assertEqual(labeled.source.port, 'bottom', 'process 出桩应为 bottom');
    assertEqual(labeled.target.port, 'top', 'decision 入桩应为 top');
  });

  it('flowDraftToX6：无 positions 时按索引纵向排列（起点 60,60 间距 110）', () => {
    const result = flowDraftToX6(draft);
    assertEqual(result.nodes.length, 4, '节点数应为 4');
    assertEqual(result.edges.length, 3, '边数应为 3');
    assertEqual(result.droppedEdges.length, 0, '不应丢弃任何边');
    assertEqual(result.degradedNodeIds.length, 0, '不应有降级节点');
    result.nodes.forEach((node, index) => {
      assertEqual(node.x, DEFAULT_ORIGIN.x, `节点 ${index} 的 x 应为 60`);
      assertEqual(node.y, DEFAULT_ORIGIN.y + index * FALLBACK_GAP_Y, `节点 ${index} 的 y 应按 110 递增`);
    });
  });

  it('flowDraftToX6：确定性（同输入两次结果完全一致）且不改入参', () => {
    const snapshotBefore = JSON.stringify(draft);
    const first = flowDraftToX6(draft, { positions: { n1: { x: 10, y: 20 } } });
    const second = flowDraftToX6(draft, { positions: { n1: { x: 10, y: 20 } } });
    assertEqual(JSON.stringify(first), JSON.stringify(second), '同输入两次转换结果应一致');
    assertEqual(at(first.nodes, 0, 'n1').x, 10, 'positions 应生效');
    assertEqual(at(first.nodes, 1, 'n2').x, DEFAULT_ORIGIN.x, '未提供 positions 的节点应走兜底');
    assertEqual(JSON.stringify(draft), snapshotBefore, 'flowDraftToX6 修改了入参');
  });

  it('flowDraftToX6：脏输入降级（缺 id / 非法 type / 悬空边 / 自环）不抛异常', () => {
    const raw: RawFlowDraft = {
      nodes: [
        { label: '缺 id', type: 'process' },
        { id: 'x', label: '非法类型', type: 'diamond' },
        { id: 'x', label: '重复 id', type: 'start' },
        { id: 'ok', label: '正常', type: 'end' },
        null as unknown as { id: string },
      ],
      edges: [
        { source: 'ok', target: '不存在' },
        { source: 'ok', target: 'ok' },
        { id: 'good', source: 'x', target: 'ok', label: '有效' },
      ],
    };
    const result = flowDraftToX6(raw);
    assertEqual(result.nodes.length, 5, '应为 5 个节点（含 null 降级项）');
    assertEqual(result.edges.length, 1, '只应保留 1 条有效边');
    assertEqual(result.droppedEdges.length, 2, '悬空边与自环应被丢弃并上报');
    assertEqual(result.degradedNodeIds.length, 2, '非法 type(diamond) 与缺失 type(null 项) 共 2 个降级节点');
    const byId = new Set(result.nodes.map((node) => node.id));
    assertEqual(byId.size, 5, '生成的 id 必须唯一');
    assertEqual(at(result.nodes, 1, 'x').data?.rawType, 'diamond', '降级节点应保留原始 type');
    assertEqual(at(result.edges, 0, 'good').id, 'good', '有效边 id 应保留');
  });

  it('normalizeFlowDraft：null/undefined 安全返回空结构', () => {
    [undefined, null, {}].forEach((input) => {
      const normalized = normalizeFlowDraft(input as RawFlowDraft);
      assertEqual(normalized.nodes.length, 0, '空输入应无节点');
      assertEqual(normalized.edges.length, 0, '空输入应无边');
    });
  });

  it('x6ToFlowDraft：flowDraftToX6 → x6ToFlowDraft 语义往返一致', () => {
    const x6 = flowDraftToX6(draft);
    const json: X6GraphJSON = { nodes: x6.nodes, edges: x6.edges };
    const back = x6ToFlowDraft(json);
    assertDeepEqual(back, draft, '往返应还原 FlowDraft 语义（id/label/type/边/边标签）');
    // cells 形式（graph.toJSON() 的真实结构）同样可读
    const viaCells = x6ToFlowDraft({ cells: [...x6.nodes, ...x6.edges] });
    assertDeepEqual(viaCells, draft, 'cells 形式往返应一致');
  });

  it('x6ToFlowDraft：用户手绘节点（仅 attrs.label.text）与悬空边也能安全回读', () => {
    const back = x6ToFlowDraft({
      cells: [
        { id: 'u1', shape: 'rect', x: 0, y: 0, width: 100, height: 40, attrs: { label: { text: '手绘节点' } } },
        { id: 'u2', shape: 'ellipse', attrs: { label: { text: '手绘开始' } } },
        { id: 'ue', shape: 'edge', source: { cell: 'u1' }, target: { cell: 'u2' } },
        { id: 'bad', shape: 'edge', source: { cell: 'u1' }, target: { cell: 'ghost' } },
        { id: 'str', shape: 'edge', source: 'u2', target: 'u1' },
      ],
    });
    assertEqual(back.nodes.length, 2, '应回读 2 个手绘节点');
    assertEqual(at(back.nodes, 0, 'u1').label, '手绘节点', '应从 attrs.label.text 回读文字');
    assertEqual(at(back.nodes, 0, 'u1').type, 'process', 'rect 应降级为 process');
    assertEqual(at(back.nodes, 1, 'u2').type, 'process', '非法 shape 应降级为 process');
    assertEqual(back.edges.length, 2, '悬空边应被过滤，字符串端点应可读');
    assertTrue(
      back.edges.every((edge) => edge.label === undefined),
      '无 label 的边不应凭空产生 label',
    );
    assertEqual(x6ToFlowDraft(undefined).nodes.length, 0, 'undefined 输入应安全返回空');
  });
});

describe('transform ↔ 后端契约交叉校验', () => {
  it('NODE_TYPE_CONFIG 覆盖且仅覆盖后端 6 种类型', () => {
    assertDeepEqual(Object.keys(NODE_TYPE_CONFIG), Object.keys(BACKEND_NODE_TYPE_META), '类型集合应与后端一致');
    assertEqual(Object.keys(NODE_TYPE_CONFIG).length, 6, '应为 6 种类型');
  });

  it('所有类型的尺寸与配置一致（布局层同源）', () => {
    Object.keys(NODE_TYPE_CONFIG).forEach((type) => {
      const config = NODE_TYPE_CONFIG[type as keyof typeof NODE_TYPE_CONFIG];
      assertDeepEqual(
        getNodeSize(type as keyof typeof NODE_TYPE_CONFIG),
        { width: config.width, height: config.height },
        `${type} getNodeSize 应与配置同源`,
      );
      assertClose(config.strokeWidth, 1.5, `${type} strokeWidth 应为 1.5`);
    });
  });
});

finish('transform');
