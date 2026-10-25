/*
 * @Description: 用于将x6导出的JSON格式转化为G6需要的JSON格式
 * @Version: 1.0
 * @Author: yangsen
 * @Date: 2022-04-25 19:35:28
 * @LastEditors: yangsen
 * @LastEditTime: 2022-05-12 21:25:03
 */

import { RcFile } from "antd/lib/upload";
import { UploadFile } from "antd/lib/upload/interface";


interface portItem {
  id: string;
  group: string;
}
interface ports {
  groups: object;
  items: portItem[];
}


interface node {
  attrs: {
    image: {
      'xlink:href': string
    },
    label: {
      text: string,
      fontSize: string,
      fill: string,
      fontWeight: string | number,
      position: string,
      offset: string;
      refX?: number;
      refY?: number;
      refX2?: number;
      refY2?: number;
    },
    body?: {
      opacity: number
    }
  };
  id: string;
  shape: string;
  zIndex: number;
  ports: ports;
  position: {
    x: number;
    y: number;
  };
  size: { width: number; height: number };
  custom_style: string
  getPolyline: () => {}
}
interface edge {
  attrs: {
    line: {
      stroke: string,
      targetMarker: {
        name: string,
        width: number,
        height: number
      }
    }
  };
  id: string;
  shape: string;
  zIndex: number;
  labels: [
    {
      attrs: {
        label: {
          text: string,
          fill: string,
          fontSize: number,
          fontWeight: number
        }
      },
      position: {
        distance: number,
        offset: number
      }
    }
  ];
  source: { cell: string; port: string };
  target: { cell: string; port: string };
  vertices: { x: number; y: number }[] | string;
  custom_style: string
  getPolyline: () => {}
}


type setfileList = (param: UploadFile<unknown>[]) => void;

export const beforeUplod = (setfileList: setfileList) => (file: RcFile, fileList: RcFile[]) => {
  setfileList([file]);
  return false;
};

export const G6Translate = async (file: RcFile, fileList: RcFile[]) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onerror = () => {
      reject(reader.error ?? new Error("文件读取失败"));
    };
    reader.onload = () => {
      try {
        const result = reader.result;
        let resultBuffer!: ArrayBuffer;
        if (Object.prototype.toString.call(result) === "[object ArrayBuffer]") {
          resultBuffer = result as ArrayBuffer;
        }
        // 生成utf-8文本解码器
        const enc = new TextDecoder("utf-8");
        // 将ArrayBuffer转换为8位无符号整形数组
        const resultUnit8: Uint8Array = new Uint8Array(resultBuffer);
        // 按着utf-8方式解码，返回一个字符串
        const resultString: string = enc.decode(resultUnit8);
        const resultArr: (node | edge)[] = JSON.parse(resultString); // resultArr是转换完成要传给后端的JSON数组

        // *****************************************************************

        // G6节点转换部分
        const nodes: node[] = resultArr.filter((item: node | edge) => {
          return item.shape !== 'edge'
        }) as node[];
        // 找出所有的透明节点，判断边的source是否是透明节点，是则加上渐变属性customer_style
        const transparent: node[] = nodes.filter((item) => item.attrs.body?.opacity === 0)
        const transparentId: string[] = transparent.map((item) => item.id)
        nodes.forEach((item) => {
          // 对于节点的操作
          // 对链接桩进行转换---节点部分；此部分因为不再采用x6算法，改用绝对定位，已经删除，如有需要去gitlab--2022.05.11

          // 节点的文字位置转换
          const top: number | undefined = item.attrs.label.refY;
          const left: number | undefined = item.attrs.label.refX;
          if (top === 0.5 && left === 0.5) {
            item.attrs.label["position"] = "center";
          } else if (top === 0) {
            item.attrs.label["position"] = "top";
          } else {
            item.attrs.label["position"] = "left";
          }
          const offsetX: number | undefined = item.attrs.label?.refX2;
          const offsetY: number | undefined = item.attrs.label?.refY2;
          if (offsetX !== undefined && offsetY !== undefined) {
            if (offsetX === 0) {
              item.attrs.label["offset"] = offsetY.toString();
            } else {
              item.attrs.label["offset"] = offsetX.toString();
            }
          }
          delete item.attrs.label.refX;
          delete item.attrs.label.refY;
          delete item.attrs.label.refX2;
          delete item.attrs.label.refY2;
          // 将fontWeight由number转string
          if (item.attrs) {
            item.attrs.label.fontWeight = (item.attrs.label.fontWeight as number).toString()
          }
          // 将节点的X,Y坐标;宽高做保留整数处理
          if (item.position) {
            item.position.x = Math.round(item.position.x)
            item.position.y = Math.round(item.position.y)
          }
          // 将节点的宽高做保留整数处理
          if (item.size) {
            item.size.width = Math.round(item.size.width)
            item.size.height = Math.round(item.size.height)
            // 将节点坐标由左上角转换为中心点
            if (item.position) {
              const width = (item.size?.width) / 2;
              const height = (item.size?.height) / 2;
              item.position.x = item.position.x + width;
              item.position.y = item.position.y + height;
            }
          }
        })

        // **************************************************************
        // G6边部分转换
        const edges: edge[] = resultArr.filter((item: node | edge) => {
          return item.shape === 'edge'
        }) as edge[];
        edges.forEach((item) => {
          // 链接桩转换--边部分;此部分因为不再采用x6算法，改用绝对定位，已经删除，如有需要去gitlab--2022.05.11

          // 为没有路径点的线加上customer_style属性type:line
          if (item.vertices?.length === 0 || item.vertices === undefined) {
            item['custom_style'] = JSON.stringify({
              "type": "line"
            })
          } else {
            // 如果vertices坐标，在节点坐标范围内，表明拐点正对链接桩，将拐点坐标改成链接桩坐标;此部分因为不再采用x6算法，改用绝对定位，已经删除，如有需要去gitlab--2022.05.11

          }
          // 路径点转换为字符串
          let verticesStr = ''
          if (typeof item.vertices === 'object') {
            item.vertices.forEach((item) => {
              verticesStr += `{ "x": ${item.x}, "y": ${item.y} },`
            })
            item.vertices = `[${verticesStr.slice(0, -1)}]`
          }
          // 为两端都是透明矩形的线添加customer_style属性
          const sourceIsTransparent = transparentId.some((val) => val === item.source.cell)
          const targetIsTransparent = transparentId.some((val) => val === item.target.cell)
          if (sourceIsTransparent && targetIsTransparent) {
            item['custom_style'] = JSON.stringify({
              "type": "line-growth-2",
              "style": {
                "endArrow": false,
                "lineWidth": 5,
                "stroke": "l(0) 0:#D2EAFB 0.5:#7ec2f3 1:#1890ff"
              }
            })
          }
        })
        resolve([...edges, ...nodes]);
      } catch (err) {
        // 文件内容非法（非 JSON / 结构缺失）时显式失败，而不是悬挂 Promise
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
  });
};

export const getUid = (len: number): string => {
  const chars: string[] = "0123456789abcdefghijklmnopqrstuvwxyz".split("");
  const idArr: string[] = new Array(len).fill("").map((item) => {
    const random = Math.floor(Math.random() * 36);
    const randomChar = chars[random];
    return randomChar;
  });
  const id: string = idArr.join("");
  return id;
};
