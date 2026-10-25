/*
 * @Author: yangsen
 * @Date: 2022-04-06 12:22:01
 * @LastEditTime: 2022-05-18 10:47:51
 * @Description: 基于X6封装的graph初始化hook
 */
import { Graph, Shape } from "@antv/x6";
import { Options } from "@antv/x6/lib/graph/options";
import { useEffect, useState } from "react";
import { getUid } from "../../pages/imoprtOutsystem/outsystem/G6translate";
import { SimpleNodeView } from '../minimapView'

interface useGraphProps {
  id: string;
  callback?: (graph: Graph) => void;
  isPreview?: boolean;
}

// 容器尚未完成布局时的兜底尺寸
const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;

// 画布尺寸跟随容器，而不是写死 1920x1080
const getContainerSize = (container?: HTMLElement) => ({
  width: container?.clientWidth || FALLBACK_WIDTH,
  height: container?.clientHeight || FALLBACK_HEIGHT,
});

export const useGraph = ({ id, callback, isPreview }: useGraphProps) => {
  const [graph, setGraph] = useState<Graph>();
  useEffect(() => {
    const handle = document.getElementById(id) || undefined;
    const minimapContainer = document.getElementById('minimapContainer') || undefined;
    const { width, height } = getContainerSize(handle);

    let graphOption: Partial<Options.Manual> = {};

    if (!isPreview) {
      graphOption = {
        container: handle,
        width,
        height,
        selecting: {
          enabled: true,
          rubberband: true, // 启用框选
          showNodeSelectionBox: true, // 节点选中之后有橙色选中框
          showEdgeSelectionBox: false, // 边选中之后有橙色选中框
          modifiers: "ctrl", // 多选按键
          movable: true, // 选中的节点是否可以被移动
          strict: true, // 框选全部包围才可以选中
        },
        resizing: {
          enabled: true, // 选中之后可以实现拖拽大小
          preserveAspectRatio: true,
        },
        // Neon Dark 画布：近黑深蓝底 + 低对比网格
        background: {
          color: "#0a0f1e",
        },
        grid: {
          size: 10,
          visible: true,
          type: "mesh",
          args: {
            color: "#1e2a47",
            thickness: 1,
          },
        },
        // 剪切板
        clipboard: {
          enabled: true,
        },
        // 绑定键盘快捷键
        keyboard: {
          enabled: true,
          global: true,
        },
        connecting: {
          anchor: "center", // 当连接到节点时，通过 anchor 来指定被连接的节点的锚点，默认值为 center。
          connectionPoint: "anchor", // 指定连接点，默认值为 boundary
          allowBlank: false, // 是否允许连接到画布空白位置的点
          highlight: true, // 拖动边时，是否高亮显示所有可用的连接桩或节点
          snap: true, // 当 snap 设置为 true 时连线的过程中距离节点或者连接桩 50px 时会触发自动吸附

          connector: {
            name: "normal",
            args: {},
          },
          createEdge() {
            return new Shape.Edge({
              id: getUid(8),
              attrs: {
                line: {
                  // 蓝灰边线：暗色画布与白底导出均可读
                  stroke: "#7d8fb0",
                  strokeWidth: 2,
                  targetMarker: {
                    name: "block",
                    width: 12,
                    height: 8,
                  },
                },
                strokeDasharray: 0,
              },
              // 为了G6暂时不要连接线的label了
              labels: [
                {
                  attrs: {
                    label: {
                      text: "",
                      fill: "#cbd5e1",
                      fontSize: 16,
                      fontWeight: 400,
                    },
                  },
                  position: {
                    distance: 0.5,
                    offset: 0,
                  },
                },
              ],
              zIndex: 0,
            });
          },
          // 在移动边的时候判断连接是否有效 在移动边的时候判断连接是否有效，如果返回 false，当鼠标放开的时候，不会连接到当前元素，否则会连接到当前元素。
          validateConnection({ sourceView, targetView, sourceMagnet, targetMagnet }) {
            if (sourceView === targetView) {
              return false;
            }
            if (!sourceMagnet) {
              return false;
            }
            if (!targetMagnet) {
              return false;
            }
            return true;
          },
        },
        // Scroller 使画布具备滚动、平移、居中、缩放等能力，默认禁用
        scroller: {
          enabled: true,
          // 是否分页，默认为 false。
          pageVisible: true,
          // 是否显示分页符，默认为 false。
          pageBreak: true,
          // 是否启用画布平移能力（在空白位置按下鼠标后拖动平移画布），默认为 false。
          pannable: true,
          autoResize: false,
          width,
          height,
          padding: 1000
        },
        // 滚轮缩放
        mousewheel: {
          enabled: true,
          modifiers: ['ctrl', 'meta'],
        },
        history: {
          enabled: true,
          ignoreAdd: false,
          ignoreRemove: false,
          ignoreChange: false,
          beforeAddCommand(event, args: any) {
            // 当是tools类型的change时，不添加到undo中
            if (args.key === "tools") {
              return false;
            }
          },
        },
        // 对齐线
        snapline: true,
        // 小地图
        minimap: {
          enabled: true,
          container: minimapContainer,
          width: 192,
          height: 108,
          padding: 5,
          graphOptions: {
            async: true,
            // 节点使用简化视图以提升小地图渲染性能；
            // 边不再返回 null 屏蔽，走默认 EdgeView，使小地图能完整呈现连线。
            getCellView(cell) {
              if (cell.isNode()) {
                return SimpleNodeView
              }
            },
          },
        }
      };
    } else {
      graphOption = {
        container: handle,
        width,
        height,
        // Neon Dark 画布：与编辑器同一套暗色基底
        background: {
          color: "#0a0f1e",
        },
        grid: {
          size: 10,
          visible: true,
          type: "mesh",
          args: {
            color: "#1e2a47",
            thickness: 1,
          },
        },
        interacting: {
          nodeMovable: false,
        },
        connecting: {
          anchor: "center", // 当连接到节点时，通过 anchor 来指定被连接的节点的锚点，默认值为 center。
          connectionPoint: "anchor", // 指定连接点，默认值为 boundary
          allowBlank: false, // 是否允许连接到画布空白位置的点
          highlight: true, // 拖动边时，是否高亮显示所有可用的连接桩或节点
          snap: true, // 当 snap 设置为 true 时连线的过程中距离节点或者连接桩 50px 时会触发自动吸附
          connector: {
            name: "normal",
            args: {},
          },
          createEdge() {
            return new Shape.Edge({
              attrs: {
                line: {
                  stroke: "#7d8fb0",
                  strokeWidth: 2,
                  targetMarker: {
                    name: "block",
                    width: 12,
                    height: 8,
                  },
                },
              },

              labels: [
                {
                  attrs: {
                    label: {
                      text: "label",
                      fill: "#cbd5e1",
                      fontSize: 16,
                      fontWeight: 500,
                    },
                  },
                  position: {
                    distance: 0.5,
                    offset: 0,
                  },
                },
              ],
              zIndex: 0,
            });
          },
        },
        scroller: {
          enabled: true,
          pageVisible: true,
          pageBreak: true,
          pannable: true,
          autoResize: false,
          width,
          height,
          padding: 1000
        },
        // 小地图
        minimap: {
          enabled: true,
          container: minimapContainer,
          width: 192,
          height: 108,
          padding: 5,
          graphOptions: {
            async: true,
            // 节点使用简化视图以提升小地图渲染性能；
            // 边不再返回 null 屏蔽，走默认 EdgeView，使小地图能完整呈现连线。
            getCellView(cell) {
              if (cell.isNode()) {
                return SimpleNodeView
              }
            },
          },
        }
      };
    }

    // 初始化graph
    const temp = new Graph(graphOption);
    if (callback) {
      callback(temp);
    }
    setGraph(temp);

    // 容器尺寸变化时同步画布（含 scroller），替代原先写死的 1920x1080
    let observer: ResizeObserver | undefined;
    let lastWidth = width;
    let lastHeight = height;
    if (handle && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        const nextWidth = handle.clientWidth;
        const nextHeight = handle.clientHeight;
        if (!nextWidth || !nextHeight) {
          return;
        }
        if (nextWidth === lastWidth && nextHeight === lastHeight) {
          return;
        }
        lastWidth = nextWidth;
        lastHeight = nextHeight;
        temp.resize(nextWidth, nextHeight);
      });
      observer.observe(handle);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
      temp.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return graph;
};