/*
 * @Author: yangsen
 * @Date: 2022-04-06 16:37:25
 * @LastEditTime: 2022-05-10 16:19:33
 * @Description: 属性展示模块demo，需要拓展成多种模块，后期可以优化，编辑器右侧
 */

import NodePanel from "./ConfigNode";
import EdgePanel from "./ConfigEdge";
import { Divider, Drawer } from "antd";
import React, { useEffect, useState } from "react";
import GridPanel from "./ConfigGrid";
import { CloseOutlined } from "@ant-design/icons";
import { Graph, Cell } from "@antv/x6";


interface attrProp {
  clickType: number;
  nowCell: { cell: Cell<Cell.Properties>; } | undefined;
  graph: Graph | undefined;
  attrVisible: boolean;
  setAttrVisible: React.Dispatch<React.SetStateAction<boolean>>
}
// 总出口
export const CellAttrs = (props: attrProp) => {
  const attrVisible = props.attrVisible;
  const setAttrVisible = props.setAttrVisible;
  useEffect(() => {
    setAttrVisible(true);
  }, [setAttrVisible]);
  // clickType === 3（点击画布空白处）时打开网格/背景设置，此时不依赖 nowCell
  if (props.graph && props.clickType === 3) {
    return (
      <Drawer
        visible={attrVisible}
        onClose={() => {
          setAttrVisible(false);
        }}
        mask={false}
        maskClosable={false}
        closeIcon={
          <CloseOutlined style={{ position: "absolute", right: "20px", top: '10px' }} />
        }
        title={<div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--yt-text-secondary)' }}>画布属性</div>}
        headerStyle={{ backgroundColor: 'rgba(16, 17, 19, 0.94)', height: '30px', borderBottom: '1px solid var(--yt-border)' }}
        bodyStyle={{ backgroundColor: '#101113', padding: 0 }}
      >
        <GridPanel graph={props.graph} />
      </Drawer>
    );
  }
  if (props.graph && props.nowCell) {
    if (props.clickType === 1) {
      return (
        <Drawer
          visible={attrVisible}
          onClose={() => {
            setAttrVisible(false);
          }}
          mask={false}
          maskClosable={false}
          closeIcon={
            <CloseOutlined style={{ position: "absolute", right: "20px", top: '10px' }} />
          }
          title={<div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--yt-text-secondary)' }}>节点属性</div>}
          headerStyle={{ backgroundColor: 'rgba(16, 17, 19, 0.94)', height: '30px', borderBottom: '1px solid var(--yt-border)' }}
          bodyStyle={{ backgroundColor: '#101113', padding: 0 }}
        >
          <NodePanel
            graph={props.graph}
            cell={props.nowCell?.cell}
            id={props.nowCell?.cell.id}
          />
        </Drawer>
      );
    } else if (props.clickType === 2) {
      return (
        <Drawer
          visible={attrVisible}
          onClose={() => {
            setAttrVisible(false);
          }}
          mask={false}
          maskClosable={false}
          closeIcon={
            <CloseOutlined style={{ position: "absolute", right: "20px", top: '10px' }} />
          }
          title={<div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--yt-text-secondary)' }}>边属性</div>}
          headerStyle={{ backgroundColor: 'rgba(16, 17, 19, 0.94)', height: '30px', borderBottom: '1px solid var(--yt-border)' }}
          bodyStyle={{ backgroundColor: '#101113', padding: 0 }}
        >
          <EdgePanel
            graph={props.graph}
            cell={props.nowCell?.cell}
            id={props.nowCell?.cell.id}
          />
        </Drawer>
      );
    }
    // clickType === 3（网格/背景设置）的入口已上移到组件顶部提前 return，
    // 因为该面板只需要 graph，不需要选中的 cell。
    else {
      return (<div />);
    }
  } else {
    return (<div />)
  }

};
