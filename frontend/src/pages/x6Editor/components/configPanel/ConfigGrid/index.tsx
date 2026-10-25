/*
 * @Description:边右侧的控制属性
 * @Version: 2.0
 * @Author: yangsen
 * @Date: 2022-04-13 16:11:04
 * @LastEditors: yangsen
 * @LastEditTime: 2022-04-22 19:40:46
 */

import { useEffect, useState } from "react";
import { Tabs, Row, Col, Input, Slider, Select, Collapse } from "antd";
import styled from "@emotion/styled";
import { Graph } from "@antv/x6";
const { TabPane } = Tabs;
const { Option } = Select;
const { Panel } = Collapse;

interface gridProp {
  GridType: string;
  GridSize: number;
  GridColor: string;
  Thickness: number;
  BackgroundColor: string;
}

interface gridPanelProps {
  graph: Graph;
}

const GridPanel = (props: gridPanelProps) => {
  const graph = props.graph;
  const [attrs, setAttrs] = useState<gridProp>({
    GridType: "mesh",
    GridSize: 10,
    GridColor: "#AAAAAA",
    Thickness: 0.5,
    BackgroundColor: "#ffffff",
  });
  useEffect(() => {
    const options = {
      type: attrs.GridType,
      visible: true,
      size: attrs.GridSize,
      args: {
        color: attrs.GridColor,
        thickness: attrs.Thickness,
      },
    };
    graph.drawGrid(options);
  }, [attrs.GridColor, attrs.GridSize, attrs.GridType, attrs.Thickness, graph]);
  useEffect(() => {
    const options = {
      color: attrs.BackgroundColor,
    };
    graph.drawBackground(options);
  }, [attrs.BackgroundColor, graph]);
  const setAttr = (key: string, val: string | number) => {
    setAttrs((prev) => ({
      ...prev,
      [key]: val,
    }));
  };
  return (
    <Collapse bordered={true} defaultActiveKey={["1"]} ghost={true}>
      <Panel header="网格" key="1">
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>网格类型</Col>
          <Col span={16}>
            <Select
              defaultValue={attrs?.GridType}
              style={{ width: 120 }}
              onChange={(val) => {
                setAttr("GridType", val);
              }}
            >
              <Option value="dot">Dot</Option>
              <Option value="fixedDot">Fixed Dot</Option>
              <Option value="mesh">Mesh</Option>
              <Option value="doubleMesh">Double Mesh</Option>
            </Select>
          </Col>
        </PaddingRow>
        <PaddingRow align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>网格大小</Col>
          <Col span={14}>
            <Slider
              min={1}
              max={20}
              step={1}
              value={attrs.GridSize}
              onChange={(val) => setAttr("GridSize", val)}
            />
          </Col>
          <Col span={2}>
            <div>{attrs.GridSize}</div>
          </Col>
        </PaddingRow>
        <PaddingRow
          align="middle"
          style={{ marginBottom: "5px", paddingLeft: "5px" }}
        >
          <Col span={8}>网格颜色</Col>
          <Col span={14}>
            <Input
              type="color"
              value={attrs.GridColor}
              style={{ width: "100%" }}
              onChange={(e) => setAttr("GridColor", e.target.value)}
            />
          </Col>
        </PaddingRow>
        <PaddingRow
          align="middle"
          style={{ marginBottom: "5px", paddingLeft: "5px" }}
        >
          <Col span={8}>网格线宽度</Col>
          <Col span={14}>
            <Slider
              min={1}
              max={20}
              step={1}
              value={attrs.Thickness}
              onChange={(val) => setAttr("Thickness", val)}
            />
          </Col>
          <Col span={2}>
            <div>{attrs.Thickness}</div>
          </Col>
        </PaddingRow>
        <PaddingRow
          align="middle"
          style={{ marginBottom: "5px", paddingLeft: "5px" }}
        >
          <Col span={8}>背景颜色</Col>
          <Col span={14}>
            <Input
              type="color"
              value={attrs.BackgroundColor}
              style={{ width: "100%" }}
              onChange={(e) => setAttr("BackgroundColor", e.target.value)}
            />
          </Col>
        </PaddingRow>
      </Panel>
    </Collapse>
  );
};
const PaddingRow = styled(Row)`
  padding: 5px;
`;
export default GridPanel;
