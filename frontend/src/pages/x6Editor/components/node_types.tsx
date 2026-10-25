/*
 * @Author: yangsen
 * @Date: 2022-04-08 17:44:15
 * @LastEditTime: 2022-05-17 21:05:28
 * @Description: 组件节点元素集合-编辑器左侧
 *
 * Task 6.1：编辑器节点体系统一到语义类型。
 *   左侧图形库不再提供 image/transparent/text 等自定义图片节点，而是与 AI 转换层
 *   （src/pages/ai/transform/*）共用同一套「6 种语义节点」配置：
 *     start / end / process / decision / io / subprocess
 *   shape（ellipse / rect / polygon）、尺寸、配色、attrs、ports 全部来自
 *   NODE_TYPE_CONFIG + buildNodeAttrs + buildPorts，保证 graph.toJSON()/fromJSON()
 *   数据结构与 transform/to-x6.ts 的 toX6Node 输出完全一致（AI 链路可互相消费）。
 */

import { Addon, Graph, Node } from "@antv/x6";
import { useEffect } from "react";
import { getUid } from "../../imoprtOutsystem/outsystem/G6translate";
import { getNodeConfig } from "../../ai/transform/node-type-config";
import { toX6Node } from "../../ai/transform/to-x6";
import type { NodeType, X6NodeData } from "../../ai/transform/types";

interface NodeTypesProps {
  graph: Graph | undefined;
}

/** 图形库分组名 */
const GROUP_NAME = "group1";

/** 面板中 6 种语义节点的展示顺序（与 NODE_TYPE_CONFIG 定义顺序一致） */
const STENCIL_NODE_TYPES: NodeType[] = [
  "start",
  "end",
  "process",
  "decision",
  "io",
  "subprocess",
];

/** 面板预览缩放比例：真实尺寸 × PREVIEW_SCALE 即为图形库中展示的尺寸 */
const PREVIEW_SCALE = 0.5;

/** Stencil 面板画布尺寸与布局（两列三行） */
const STENCIL_WIDTH = 220;
const STENCIL_HEIGHT = 230;
const STENCIL_COLUMN_WIDTH = 100;
const STENCIL_ROW_HEIGHT = 70;

/**
 * 生成图形库预览节点数据。
 * shape / attrs / ports 与拖入画布后的节点完全同源（toX6Node → buildNodeAttrs / buildPorts），
 * 仅尺寸按比例缩小，避免面板被 140×80 的真实节点撑爆。
 * polygon 的 refPoints 由 X6 按节点尺寸相对解析，缩小尺寸不会破坏菱形/平行四边形形状。
 */
function createStencilNodeMeta(type: NodeType): X6NodeData {
  const config = getNodeConfig(type);
  // 坐标由 Stencil 的 layoutOptions 统一排布，这里给 0,0 占位
  const meta = toX6Node(
    { id: `${type}-preview`, label: config.label, type },
    { pos: { x: 0, y: 0 }, origin: "canvas" },
  );
  meta.width = Math.max(24, Math.round(config.width * PREVIEW_SCALE));
  meta.height = Math.max(20, Math.round(config.height * PREVIEW_SCALE));
  return meta;
}

/**
 * 用转换层的纯数据结构创建节点。
 * X6 的 Node.Metadata 对 attrs 值的索引签名要求更严（不接受数组值），
 * 而 X6NodeData 是「可直接喂给 graph.fromJSON」的宽松纯数据类型；
 * 二者运行时结构一致，此处仅做类型桥接。
 */
function createSemanticNode(graph: Graph, meta: X6NodeData): Node {
  return graph.createNode(meta as unknown as Parameters<Graph["createNode"]>[0]);
}

/**
 * 拖入画布时按语义类型重建真实节点：
 * 尺寸还原为 NODE_TYPE_CONFIG 的真实尺寸，id 重新生成（8 位，沿用既有编辑器约定），
 * data.origin 标记为 canvas，便于 AI 匹配层区分「用户手绘节点」与「AI 生成节点」。
 */
function createDropNodeMeta(type: NodeType): X6NodeData {
  const config = getNodeConfig(type);
  return toX6Node(
    { id: getUid(8), label: config.label, type },
    { pos: { x: 0, y: 0 }, origin: "canvas" },
  );
}

export const NodeTypes = (props: NodeTypesProps) => {
  const { graph } = props;
  useEffect(() => {
    const container = document.getElementById("LeftMenu");
    if (!graph || !container) {
      return;
    }
    // graph 变化时容器可能被重复挂载，先清空旧面板避免叠加
    container.innerHTML = "";

    const stencil = new Addon.Stencil({
      target: graph,
      title: "流程图节点",
      stencilGraphWidth: STENCIL_WIDTH,
      stencilGraphHeight: STENCIL_HEIGHT,
      groups: [
        {
          title: "流程图节点",
          name: GROUP_NAME,
        },
      ],
      layoutOptions: {
        columns: 2,
        columnWidth: STENCIL_COLUMN_WIDTH,
        rowHeight: STENCIL_ROW_HEIGHT,
      },
      // 拖拽过程中的预览节点：沿用面板节点（克隆，保持 id）
      getDragNode: (node) => node.clone({ keepId: true }),
      // 落入画布时重建为真实尺寸的语义节点，端口/attrs 与 AI 转换层输出一致
      getDropNode: (node) => {
        const type = (node.getData()?.nodeType ?? "process") as NodeType;
        return createSemanticNode(graph, createDropNodeMeta(type));
      },
    });
    container.appendChild(stencil.container);

    stencil.load(
      STENCIL_NODE_TYPES.map((type) => createSemanticNode(graph, createStencilNodeMeta(type))),
      GROUP_NAME,
    );

    return () => {
      // remove() 内部会清理各预览子图、Dnd 实例与 document 级事件监听
      stencil.remove();
      container.innerHTML = "";
    };
  }, [graph]);

  return <div id="LeftMenu" style={{ width: "100%", height: "100%", overflow: "auto" }} />;
};
