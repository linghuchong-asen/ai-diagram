/*
 * @Author: yangsen
 * @Date: 2022-04-06 12:22:01
 * @LastEditTime: 2024-12-02 11:28:01
 * @Description: 编辑器index
 */

import { Cell, Graph } from "@antv/x6";
import styled from "@emotion/styled";
import { Row, Col, notification } from "antd";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useGraph } from "../../utils/hooks/useGraph";
import { useIsMobile } from "../../utils/hooks/useIsMobile";
import { clearTrialDraft, readTrialDraft } from "../../utils/trialIdentity";
import { dataClean, fromjsonData } from "../preView";
import { useGetEditorData, useGetProjectInfo } from "../preView/server";
import WatermarkOverlay from "../shared/WatermarkOverlay";
import { CellAttrs } from "./components/configPanel";
import { NodeTypes } from "./components/node_types";
import ToolBar from "./components/toolBar";
import AiFloatWindow from "../ai/ai_float_window";

export interface nowNodePro {
  x: number;
  y: number;
  cell: Cell;
}

interface EditorUrlParams {
  projectid: string;
  projectName: string;

}
// 设置链接桩
export const ports = {
  groups: {
    top: {
      position: "top",
      attrs: {
        circle: {
          r: 3,
          magnet: true,
          stroke: "#31d0c6",
          strokeWidth: 2,
          fill: "#0a0f1e",
          visibility: "hidden",
        },
      },
    },
    bottom: {
      position: "bottom",
      attrs: {
        circle: {
          r: 3,
          magnet: true,
          stroke: "#31d0c6",
          strokeWidth: 2,
          fill: "#0a0f1e",
          visibility: "hidden",
        },
      },
    },
    left: {
      position: "left",
      attrs: {
        circle: {
          r: 3,
          magnet: true,
          stroke: "#31d0c6",
          strokeWidth: 2,
          fill: "#0a0f1e",
          visibility: "hidden",
        },
      },
    },
    right: {
      position: "right",
      attrs: {
        circle: {
          r: 3,
          magnet: true,
          stroke: "#31d0c6",
          strokeWidth: 2,
          fill: "#0a0f1e",
          visibility: "hidden",
        },
      },
    },
  },
  items: [
    {
      id: "[0.5,0]",
      group: "top", // 指定分组名称
    },
    {
      id: "[0.5,1]",
      group: "bottom", // 指定分组名称
    },
    {
      id: "[0,0.5]",
      group: "left", // 指定分组名称
    },
    {
      id: "[1,0.5]",
      group: "right", // 指定分组名称
    },
  ],
};

export const X6Page = () => {
  const [nowCell, setCell] = useState<nowNodePro>();
  const { projectid, projectName } = useParams<keyof EditorUrlParams>();
  const [ready, setReady] = useState<Boolean>(false);
  const [attrVisible, setAttrVisible] = useState<boolean>(false);
  const [preData, setPreData] = useState<fromjsonData[]>([]);
  const [miniVisible, setMiniVisible] = useState<boolean>(true)
  // 移动端轻客户端策略：隐藏拖拽图形库（触屏不可用），画布占满全宽，
  // AI 全屏对话成为移动端主入口，编辑动作收敛到顶栏紧凑工具条
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!projectid) {
      notification.error({ message: '项目id为空' })
    }
  }, [projectid]);
  const { data: editorDataResponse } = useGetEditorData({ projectId: projectid as string });
  /** 免费档判定：unlocked 后端并行开发中，防御式读取（undefined !== true → 视为未解锁，画布带水印） */
  const { data: projectInfo } = useGetProjectInfo(projectid);
  const unlocked = projectInfo?.data?.unlocked === true;

  useEffect(() => {
    // 处理获取到的editor数据（dataClean 与 preView 共用同一实现）
    if (editorDataResponse?.data) {
      const { editorData } = editorDataResponse.data;
      setPreData(dataClean(editorData));
    }
  }, [editorDataResponse]);
  // 0:画布 1：点 2：边
  const [clickType, setClickType] = useState<number>(0);

  // 业务特殊配置,需要拓展
  const configFun = (graph: Graph) => {
    graph?.on("cell:mouseup", ({ x, y, cell }) => {
      setAttrVisible(true);
      if (cell.isEdge()) {
        setClickType(2);
        setCell({ x, y, cell });
      }
    });
    // 双击：节点打开节点属性面板，边移除工具按钮（原先分散在两处注册同一事件，已合并）
    graph.on("cell:dblclick", ({ x, y, cell }) => {
      if (cell.isNode()) {
        setClickType(1);
        setCell({ x, y, cell });
      } else if (cell.isEdge()) {
        cell.removeTools();
      }
    });
    graph?.on("blank:click", () => {
      setAttrVisible(true);
      setClickType(3);
      const container = document.getElementById("container");
      const ports = container?.querySelectorAll(".x6-port-body");
      showPorts(ports, false);
      graph.getNodes().forEach((item) => {
        item.removeTools();
      });
    });
    // 控制连接桩显示/隐藏
    const showPorts = (ports: any, show: boolean) => {
      for (let i = 0, len = ports.length; i < len; i = i + 1) {
        ports[i].style.visibility = show ? "visible" : "hidden";
      }
    };
    graph.on("cell:mouseenter", ({ cell }) => {
      const container = document.getElementById("container");
      const ports = container?.querySelectorAll(".x6-port-body");
      showPorts(ports, true);

      if (cell.isNode()) {
        cell.addTools([
          {
            name: "button-remove",
            args: {
              x: 0,
              y: 0,
              offset: { x: -10, y: 10 },
            },
          },
        ]);
      } else {
        cell.addTools([
          {
            name: "vertices",
            args: { stopPropagation: false }, // 防止触发边的mouseup
          },
          {
            name: "button-remove",
            args: {
              x: 0,
              y: 0,
              width: '1px',
              height: '1px',
              offset: { x: 20, y: 0 },
            },
          },
        ]);
      }
    });
    graph.on("cell:mouseleave", ({ cell }) => {
      cell.removeTools();
      const container = document.getElementById("container");
      const ports = container?.querySelectorAll(".x6-port-body");
      showPorts(ports, false);
    });
    setReady(true);


  };
  // 生成graph实例
  const graph = useGraph({
    id: "container",
    callback: configFun,
  });

  // 试用草稿继承（增长方案）：URL 带 ?draft=1 且本地存有试用草稿时，
  // 画布就绪后用草稿初始化（只消费一次防重复应用）；应用成功后本会话内
  // 不再回放服务端数据（新建项目服务端为空画布，避免异步载入把草稿冲掉）
  const [searchParams] = useSearchParams();
  const isDraftImport = searchParams.get("draft") === "1";
  const draftCheckedRef = useRef(false);
  const [draftApplied, setDraftApplied] = useState(false);

  useEffect(() => {
    if (graph) {
      if (isDraftImport && !draftCheckedRef.current) {
        draftCheckedRef.current = true;
        const draft = readTrialDraft();
        if (draft && draft.editorData.length > 0) {
          graph.fromJSON(draft.editorData as fromjsonData[]);
          graph.centerContent();
          clearTrialDraft();
          setDraftApplied(true);
          return;
        }
        // 无有效草稿（如刷新后已消费）：回落正常载入
      }
      if (!draftApplied) {
        // 从数据库查询当前项目JSON数据，生成之前的链路图
        graph?.fromJSON(preData);
      }
    }
  }, [graph, preData, isDraftImport, draftApplied]);

  return (
    <div>
      <Container>
        <Row style={{ height: "100%", overflow: 'hidden' }}>
          {/* 图形库（拖拽来源）：触屏拖拽不可用，移动端隐藏 */}
          {!isMobile && (
            <Col
              span={4}
              style={{
                height: "100%",
                background: "rgba(13, 19, 38, 0.55)",
                borderRight: "1px solid var(--yt-border)",
              }}
            >
              <NodeTypes graph={graph} />
            </Col>
          )}
          <Col span={isMobile ? 24 : 20} style={{ position: "relative" }}>
            <div id="container" style={{ width: "100%", height: "100%" }} />
            {/* 免费档水印：compact 上移避让 AI 悬浮球；pointer-events:none 天然不挡工具栏/浮窗交互 */}
            {!unlocked && <WatermarkOverlay compact />}
            {ready && graph && projectid && projectName && <ToolBar graph={graph} projectid={projectid} projectName={projectName} miniVisible={miniVisible} setMiniVisible={setMiniVisible} isMobile={isMobile} />}
          </Col>
          <CellAttrs
            clickType={clickType}
            nowCell={nowCell}
            graph={graph}
            attrVisible={attrVisible}
            setAttrVisible={setAttrVisible}
          />
        </Row>
      </Container>
      <MinimapContainer id="minimapContainer" style={{ display: miniVisible ? 'block' : 'none' }} />
      {/* AI 浮窗：以 props 传入 graph 实例与 projectId（/editor/:projectid/:projectName 路由参数） */}
      <AiFloatWindow graph={graph} projectId={projectid} />
    </div>

  );
};

const Container = styled.div`
  width: 100vw;
  height: 100vh;
`;
const MinimapContainer = styled.div`
  width: 192px;
  height: 108px;
  position: fixed;
  top: 10px;
  right:10px;
`
