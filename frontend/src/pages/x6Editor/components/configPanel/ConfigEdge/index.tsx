/*
 * @Description:边右侧的控制属性
 * @Version: 2.0
 * @Author: yangsen
 * @Date: 2022-04-13 16:11:04
 * @LastEditors: yangsen
 * @LastEditTime: 2022-05-16 18:30:18
 */

import { useEffect, useState } from "react";
import { Row, Col, Input, Slider, Select, Collapse } from "antd";
import styled from "@emotion/styled";
import { Cell, Graph, Edge } from "@antv/x6";
import { CaretRightOutlined } from "@ant-design/icons";
const { Option } = Select;
const { Panel } = Collapse;

interface position {
  x: number;
  y: number;
}
interface edgeAttrs {
  id?: string;
  edge_width: number;
  edge_color: string;
  vertices: position;
  dasharray: string;
  connector: string;
  label?: string;
  label_position: number;
  label_offset: number;
  label_color?: string;
  font_size?: number;
  font_weight?: number;
}
const EdgePanel = (props: { id: string; cell: Cell<Cell.Properties>; graph: Graph }) => {
  const id = props.id;

  const cell = props.cell as Edge;


  const graph = props.graph;
  const [attrs, setAttrs] = useState<edgeAttrs>({
    id: "",
    edge_width: 0,
    edge_color: "#7d8fb0",
    vertices: { x: 0, y: 0 },
    dasharray: "实线",
    connector: "jumpover",
    label: "",
    label_position: 0.5,
    label_offset: 0,
    label_color: "#cbd5e1",
    font_size: 14,
    font_weight: 400,
  });

  useEffect(() => {
    if (id) {
      if (!cell || !cell.isEdge()) {
        return;
      }
      const connector =
        (cell.getConnector() && cell.getConnector().name) || "jumpover";
      const isDash = cell.attr("line/strokeDasharray") === 5 ? "dash" : "solid";
      const type_labels: Edge.Label[] = cell.getLabels();
      const type_label_position: Edge.LabelPosition | undefined = cell.getLabels()[0]?.position
      if (type_labels && type_label_position) {
        setAttrs({
          id: cell.getProp("id"),
          edge_width: cell.attr("line/strokeWidth"),
          edge_color: cell.attr("line/stroke"),
          vertices: cell.attr("line/vertices"),
          dasharray: isDash,
          connector: connector,
          label: cell.getLabels()[0]?.attrs?.label.text as string,
          label_position: (cell.getLabels()[0].position as Edge.LabelPositionObject).distance,
          label_offset: (cell.getLabels()[0].position as Edge.LabelPositionObject).offset as number,
          // 边 label 颜色约定存于 labels[0].attrs.label.fill（与 useGraph.createEdge / to-x6.buildEdgeLabel 一致）
          label_color: cell.getLabels()[0]?.attrs?.label.fill as string,
          font_size: cell.getLabels()[0]?.attrs?.label.fontSize as number,
          font_weight: cell.getLabels()[0]?.attrs?.label.fontWeight as number,
        });
      }
    }
  }, [cell, graph, id]);
  const setAttr = (key: string, val: number | string) => {
    setAttrs((prev) => ({
      ...prev,
      [key]: val,
    }));
  };
  const onEdgeWidthChange = (val: number) => {
    setAttr("edge_width", val);
    cell.attr("line/strokeWidth", val);
  };
  const onEdgeColorChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    setAttr("edge_color", val);
    cell.attr("line/stroke", val);
  };
  const onLabelChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      attrs: {
        label: {
          ...cell.getLabels()[0]?.attrs?.label,
          text: val,
        },
      },
    });
    setAttr("label", val);
  };
  const onLabelPositionChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      position: {
        distance: parseFloat(val),
        offset: (cell.getLabels()[0].position as Edge.LabelPositionObject).offset as number,
      },
    });
    setAttr("label_position", val);
  };
  const onLabelOffsetChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      position: {
        distance: (cell.getLabels()[0].position as Edge.LabelPositionObject).distance,
        offset: parseFloat(val),
      },
    });
    setAttr("label_offset", val);
  };
  const onColorChange = (e: { target: { value: any } }) => {
    const val = e.target.value;
    // 修复：原实现 cell.attr("text/fill") 无对应 selector，不会生效；
    // 按项目约定写入 labels[0].attrs.label.fill，并同步 state key 为 label_color
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      attrs: {
        ...cell.getLabels()[0].attrs,
        label: { ...cell.getLabels()[0].attrs?.label, fill: val },
      },
    });
    setAttr("label_color", val);
  };
  const onFontSizeChange = (val: number) => {
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      attrs: {
        ...cell.getLabels()[0].attrs,
        label: { ...cell.getLabels()[0].attrs?.label, fontSize: val }
      }
    });
    setAttr("font_size", val);
  };
  const onFontWeightChange = (val: number) => {
    cell.setLabelAt(0, {
      ...cell.getLabels()[0],
      attrs: {
        ...cell.getLabels()[0].attrs,
        label: { ...cell.getLabels()[0].attrs?.label, fontWeight: val }
      }
    });
    setAttr("font_weight", val);
  }
  const onConnectorChange = (param: string) => {
    switch (param) {
      case "normal":
        cell.setConnector("normal");
        setAttr("connector", "normal");
        break;
      case "smooth":
        cell.setConnector("smooth");
        setAttr("connector", "smooth");
        break;
      case "rounded":
        cell.setConnector("rounded");
        setAttr("connector", "rounded");
        break;
      case "jumpover":
        cell.setConnector("jumpover");
        setAttr("connector", "jumpover");
        break;
      default:
        break;
    }
  };
  const onDasharrayChange = (param: string) => {
    switch (param) {
      case "solid":
        cell.attr("line/strokeDasharray", 0);
        setAttr("dasharray", "实线");
        break;
      case "dash":
        cell.attr("line/strokeDasharray", 5);
        setAttr("dasharray", "虚线");

        break;
    }
  };
  return (
    <Collapse bordered={true} defaultActiveKey={["1"]} ghost={false} expandIcon={({ isActive }) => {
      return expandIcon(isActive)
    }}>
      <Panel header="线条" key="1" style={{ backgroundColor: '#15171a' }}>
        <Row align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>Id</Col>
          <Col span={14}>
            <Input type="text" value={attrs.id} style={{ width: "100%" }} />
          </Col>
        </Row>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>宽度</Col>
          <Col span={12}>
            <Slider
              min={1}
              max={10}
              step={1}
              value={attrs.edge_width}
              onChange={onEdgeWidthChange}
            />
          </Col>
          <Col span={2}>
            <div>{attrs.edge_width}</div>
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>颜色</Col>
          <Col span={14}>
            <Input
              type="color"
              value={attrs.edge_color}
              style={{ width: "100%" }}
              onChange={onEdgeColorChange}
            />
          </Col>
        </PaddingRow>
        <PaddingRow
          align="middle"
          style={{ marginBottom: "5px", paddingLeft: "5px" }}
        >
          <Col span={8}>实线/虚线</Col>
          <Col span={14}>
            <Select
              value={attrs?.dasharray}
              style={{ width: 120 }}
              onChange={onDasharrayChange}
            >
              <Option value="solid">实线</Option>
              <Option value="dash">虚线</Option>
            </Select>
          </Col>
        </PaddingRow>
        <PaddingRow
          align="middle"
          style={{ marginBottom: "5px", paddingLeft: "5px" }}
        >
          <Col span={8}>拐点样式</Col>
          <Col span={14}>
            <Select
              value={attrs.connector}
              style={{ width: 120 }}
              onChange={onConnectorChange}
            >
              <Option value="normal">简单连接器</Option>
              <Option value="smooth">平滑连接器</Option>
              <Option value="rounded">圆角连接器</Option>
              <Option value="jumpover">跳线连接器</Option>
            </Select>
          </Col>
        </PaddingRow>
      </Panel>
      <Panel header="文本" key="2" style={{ backgroundColor: '#15171a' }}>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>内容</Col>
          <Col span={14}>
            <input
              type="text"
              value={attrs.label}
              style={{ width: "100%" }}
              onChange={onLabelChange}
            />
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>轴向偏移</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs.label_position}
              style={{ width: "100%" }}
              step={0.01}
              onChange={onLabelPositionChange}
            />
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>垂直偏移</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs.label_offset}
              style={{ width: "100%" }}
              step={1}
              onChange={onLabelOffsetChange}
            />
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>颜色</Col>
          <Col span={14}>
            <Input
              type="color"
              value={attrs.label_color}
              style={{ width: "100%" }}
              onChange={onColorChange}
            />
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>字号</Col>
          <Col span={12}>
            <Slider
              min={8}
              max={24}
              step={1}
              value={attrs.font_size}
              onChange={onFontSizeChange}
            />
          </Col>
          <Col span={2}>
            <div>{attrs.font_size}</div>
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>粗细</Col>
          <Col span={14}>
            <Select
              value={attrs?.font_weight}
              style={{ width: "100%" }}
              onChange={onFontWeightChange}
            >
              <Option value={100}>100</Option>
              <Option value={200}>200</Option>
              <Option value={300}>300</Option>
              <Option value={400}>400</Option>
              <Option value={500}>500</Option>
              <Option value={600}>600</Option>
              <Option value={700}>700</Option>
              <Option value={800}>800</Option>
              <Option value={900}>900</Option>
            </Select>
          </Col>
        </PaddingRow>
      </Panel>
    </Collapse>
  );
};
const expandIcon = (isActive: boolean | undefined) => <CaretRightOutlined rotate={isActive ? 90 : 0} />
const PaddingRow = styled(Row)`
  padding: 5px;
`;
export default EdgePanel;
