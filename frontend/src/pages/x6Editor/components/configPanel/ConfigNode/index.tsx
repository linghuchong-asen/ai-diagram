/*
 * @Description:节点的右侧控制属性
 * @Version: 2.0
 * @Author: yangsen
 * @Date: 2022-04-13 16:11:04
 * @LastEditors: yangsen
 * @LastEditTime: 2022-05-12 18:26:45
 */


import { useEffect, useState } from "react";
import {
  Row,
  Col,
  Input,
  Slider,
  Select,
  Collapse,
} from "antd";
import { Cell, Graph, } from "@antv/x6";
import { CaretRightOutlined } from "@ant-design/icons";
const { Option } = Select;
const { Panel } = Collapse;

interface nodePro {
  id: string;
  x_axis: number;
  y_axis: number;
  width: number;
  height: number;
  img_varchar: string;
  label: string;
  label_color: string;
  font_size: number;
  font_weight: number;
  text_position: string;
  text_offset: number;
  body_stroke: string;
  body_strokeWidth: number;
  body_fill: string;
}
interface props {
  graph: Graph;
  cell: Cell;
  id: string;
}
interface imgAttr {
  fill: string;
  refHeight: string;
  refWidth: string;
  stroke: string;
  strokeWidth: number;
  "xlink:href": string;
}
/**
 * @@description: 节点属性组件
 * @@return: reactNode
 * @@author: yangsen
 * @param {props} props
 */
const NodePanel = (props: props) => {
  const id = props.id;
  const cell = props.cell;
  const graph = props.graph;
  const [attrs, setAttrs] = useState<Partial<nodePro> | undefined>({
    id: "",
    x_axis: 0,
    y_axis: 0,
    width: 0,
    height: 0,
    img_varchar: "",
    label: "",
    label_color: "#000000",
    font_size: 14,
    font_weight: 400,
    text_position: "center",
    text_offset: 0,
    body_stroke: "#000000",
    body_strokeWidth: 1,
    body_fill: "#ffffff",
  });
  const [imgName, setImgName] = useState<string>("");
  const [nodeOffset, setOffset] = useState<number>(0);

  useEffect(() => {
    if (id) {
      if (!cell || !cell.isNode()) {
        return;
      }
      if (cell.getProp("shape") === "image") {
        const imgUrl: imgAttr = cell?.attr("image");
        const imgUrlStr = imgUrl["xlink:href"];
        const length = imgUrlStr.split("/").length;
        setImgName(imgUrlStr.split("/")[length - 1].slice(0, -4));
      }
      const top: number = cell.attr("label/refY");
      const left: number = cell.attr("label/refX");
      let textPosition!: string;
      if (top === 0.5 && left === 0.5) {
        textPosition = "center";
      } else if (top === 0) {
        textPosition = "top";
      } else {
        textPosition = "left";
      }
      const offsetX: number = cell.attr("label/refX2");
      const offsetY: number = cell.attr("label/refY2");
      if (offsetX === 0) {
        setOffset(offsetY);
      } else {
        setOffset(offsetX);
      }
      const xGet = cell.getProp("position")?.x;
      const yGet = cell.getProp("position")?.y;
      const widthGet = cell.getProp("size")?.width;
      const heightGet = cell.getProp("size")?.height;
      setAttrs({
        id: cell.getProp("id"),
        x_axis: xGet && Math.round(xGet),
        y_axis: yGet && Math.round(yGet),
        width: widthGet && Math.round(widthGet),
        height: heightGet && Math.round(heightGet),
        img_varchar: imgName,
        label: cell.attr("label/text"),
        label_color: cell.attr("label/fill"),
        font_size: cell.attr("label/fontSize"),
        font_weight: cell.attr("label/fontWeight"),
        text_position: textPosition,
        text_offset: nodeOffset,
        body_stroke: cell.attr("body/stroke"),
        body_strokeWidth: cell.attr("body/strokeWidth"),
        body_fill: cell.attr("body/fill"),
      });
      const onNodeMoved = () => {
        // 拖动节点，右侧的视图变化
        const movedX = cell.getProp("position")?.x;
        const movedY = cell.getProp("position")?.y;
        setAttr("x_axis", movedX && Math.round(movedX));
        setAttr("y_axis", movedY && Math.round(movedY));
      };
      const onNodeResized = () => {
        // 拉伸节点，右侧的视图变化
        const resizedWidth = cell.getProp("size")?.width;
        const resizedHeight = cell.getProp("size")?.height;
        setAttr("width", resizedWidth && Math.round(resizedWidth));
        setAttr("height", resizedHeight && Math.round(resizedHeight));
      };
      graph.on("node:moved", onNodeMoved);
      graph.on("node:resized", onNodeResized);
    }
    return () => {
      /* 
        因为在useEffect中有点击事件graph.on(异步操作)，点击空白，当前组件销毁；
        再次点击节点，当前组件挂载，当如果不在组件卸载时清空状态，异步操作拿到的就还是上一次的组件的状态，
        此时就会报错不能在已经卸载的组件上更新state
       */
      // 卸载时解绑，避免反复打开属性面板造成监听器叠加泄漏
      graph.off("node:moved");
      graph.off("node:resized");
      setAttrs({});
    };
  }, [cell, graph, id, imgName, nodeOffset]);
  const setAttr = (key: string, val: string | number | undefined) => {
    setAttrs((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const onxChange = (e: { target: { value: string } }) => {
    const val = parseInt(e.target.value, 10);
    cell.setProp("position", { x: val, y: cell.getProp("position").y });
    setAttr("x_axis", val);
  };
  const onyChange = (e: { target: { value: string } }) => {
    const val = parseInt(e.target.value, 10);
    cell.setProp("position", { x: cell.getProp("position").x, y: val });
    setAttr("y_axis", val);
  };
  const onWidthChange = (e: { target: { value: string } }) => {
    const val = parseInt(e.target.value, 10);
    cell.setProp("size", { width: val, height: cell.getProp("size").height });
    setAttr("width", val);
  };
  const onHeightChange = (e: { target: { value: string } }) => {
    const val = parseInt(e.target.value, 10);
    cell.setProp("size", { width: cell.getProp("size").width, height: val });
    setAttr("height", val);
  };
  const onStrokeChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.attr("body/stroke", val);
    setAttr("body_stroke", val);
  };

  const onStrokeWidthChange = (val: number) => {
    cell.attr("body/strokeWidth", val);
    setAttr("body_strokeWidth", val);
  };

  const onFillChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.attr("body/fill", val);
    setAttr("body_fill", val);
  };
  const onLabelChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.attr("label/text", val);
    setAttr("label", val);
  };
  const onFontSizeChange = (val: number) => {
    cell.attr("label/fontSize", val);
    setAttr("font_size", val);
  };
  const onFontWeightChange = (val: number) => {
    cell.attr("label/fontWeight", val);
    setAttr("font_weight", val);
  };

  const onColorChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    cell.attr("label/fill", val);
    setAttr("label_color", val);
  };


  const onTextPositionChange = (params: string) => {
    switch (params) {
      case "center":
        cell.attr("label/refX", 0.5);
        cell.attr("label/refY", 0.5);
        cell.attr("label/refX2", 0);
        cell.attr("label/refY2", 0);
        setAttr("text_offset", 0);
        setAttr("text_position", "center");
        break;
      case "top":
        cell.attr("label/refX", 0.5);
        cell.attr("label/refY", 0);
        cell.attr("label/refX2", 0);
        setAttr("text_offset", 0);
        setAttr("text_position", "top");
        break;
      case "left":
        cell.attr("label/refX", 0);
        cell.attr("label/refY", 0.5);
        cell.attr("label/refY2", 0);
        setAttr("text_offset", 0);
        setAttr("text_position", "left");
        break;
      default:
        break;
    }
  };
  const onTextOffsetChange = (e: { target: { value: string } }) => {
    const val = parseInt(e.target.value, 10);
    if (attrs?.text_position === "top") {
      cell.attr("label/refY2", -val);
      cell.attr("label/refX2", 0);
      setAttr("text_offset", val);
    } else if (attrs?.text_position === "left") {
      cell.attr("label/refX2", val);
      cell.attr("label/refY2", 0);
      setAttr("text_offset", val);
    } else {
      setAttr("text_offset", 0.5);
    }
  };
  /*
   * 说明：原 changePorts（在属性面板手动增减四边链接桩数量）逻辑已移除。
   * 语义节点的链接桩统一由 pages/ai/transform/port-groups.ts 生成
   * （start 仅 bottom、end 仅 top、process/decision/io/subprocess 四向），
   * 若允许面板自行增删会与 AI 链路 graph.toJSON()/fromJSON() 的数据结构不一致。
   * 对应的“链接桩” Panel UI 此前已被整段注释，属不可达死代码。
   */
  return (
    <Collapse bordered={true} defaultActiveKey={["1"]} ghost={false} style={{}} expandIcon={({ isActive }) => {
      return expandIcon(isActive)
    }}>
      <Panel header="节点" key="1" style={{ backgroundColor: '#18223d' }}>
        <Row align="middle" style={{ marginBottom: "5px" }}>
          <Col span={8}>Id</Col>
          <Col span={14}>
            <input
              type="text"
              value={attrs?.id}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              readOnly
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>x坐标</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs?.x_axis}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onxChange}
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>y坐标</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs?.y_axis}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onyChange}
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>宽度</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs?.width}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onWidthChange}
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>高度</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs?.height}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onHeightChange}
            />
          </Col>
        </Row>

        {cell && cell.shape !== "image" ? (
          <div>
            <Row
              align="middle"
              style={{ marginBottom: "5px", paddingLeft: "5px" }}
            >
              <Col span={8}>边框颜色</Col>
              <Col span={14}>
                <Input
                  type="color"
                  value={attrs?.body_stroke}
                  style={{ width: "100%" }}
                  onChange={onStrokeChange}
                />
              </Col>
            </Row>
            <Row
              align="middle"
              style={{ marginBottom: "5px", paddingLeft: "5px" }}
            >
              <Col span={8}>边框宽度</Col>
              <Col span={14}>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={attrs?.body_strokeWidth}
                  onChange={onStrokeWidthChange}
                />
              </Col>
              <Col span={2}>
                <div>{attrs?.body_strokeWidth}</div>
              </Col>
            </Row>
            <Row
              align="middle"
              style={{ marginBottom: "5px", paddingLeft: "5px" }}
            >
              <Col span={8}>填充颜色</Col>
              <Col span={14}>
                <Input
                  type="color"
                  value={attrs?.body_fill}
                  style={{ width: "100%" }}
                  onChange={onFillChange}
                />
              </Col>
            </Row>
          </div>
        ) : (
          ""
        )}
      </Panel>
      <Panel header="文本" key="2" style={{ backgroundColor: '#18223d' }}>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>内容</Col>
          <Col span={14}>
            <input
              type="text"
              value={attrs?.label}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onLabelChange}
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>颜色</Col>
          <Col span={14}>
            <Input
              type="color"
              value={attrs?.label_color}
              style={{ width: "100%" }}
              onChange={onColorChange}
            />
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>字号</Col>
          <Col span={14}>
            <Slider
              min={8}
              max={24}
              step={1}
              value={attrs?.font_size}
              onChange={onFontSizeChange}
            />
          </Col>
          <Col span={2}>
            <div>{attrs?.font_size}</div>
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
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
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>位置</Col>
          <Col span={14}>
            <Select
              value={attrs?.text_position}
              style={{ width: "100%" }}
              onChange={onTextPositionChange}
            >
              <Option value="center">center</Option>
              <Option value="top">top</Option>
              <Option value="left">left</Option>
            </Select>
          </Col>
        </Row>
        <Row align="middle" style={{ marginBottom: "5px", paddingLeft: "5px" }}>
          <Col span={8}>位移:px</Col>
          <Col span={14}>
            <input
              type="number"
              value={attrs?.text_offset}
              step={1}
              style={{ width: "100%", border: "1px solid #D9D9D9" }}
              onChange={onTextOffsetChange}
            />
          </Col>
        </Row>
      </Panel>
    </Collapse >
  );
};
const expandIcon = (isActive: boolean | undefined) => <CaretRightOutlined rotate={isActive ? 90 : 0} />
export default NodePanel;
