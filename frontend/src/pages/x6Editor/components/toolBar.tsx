/*
 * @Description:
 * @Version: 2.0
 * @Author: yangsen
 * @Date: 2022-04-14 15:36:12
 * @LastEditors: yangsen
 * @LastEditTime: 2024-12-02 16:50:38
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Toolbar } from "@antv/x6-react-components";

import {
  ArrowLeftOutlined,
  UndoOutlined,
  RedoOutlined,
  ZoomOutOutlined,
  ZoomInOutlined,
  SaveOutlined,
  EyeOutlined,
  DownloadOutlined,
  FileTextOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import "@antv/x6-react-components/es/toolbar/style/index.css";
import "@antv/x6-react-components/es/menu/style/index.css";
import _ from "underscore";
import { Button, Input, Modal, notification } from 'antd';
import { useSaveEditorData } from "../server";
import { fromjsonData } from "../../preView";
import { Graph } from "@antv/x6";
import { getUid } from '../../imoprtOutsystem/outsystem/G6translate'
import Icon from "../../../assets/icon/icon";
import { useGetEditorData } from "../../preView/server";
import { useCreateShare } from "../../share/server";
import { copyText } from "../../../utils/clipboard";
import { exportPng, exportSvg } from "../../../utils/exportImage";

const Item = Toolbar.Item;
const Group = Toolbar.Group;

// 缩放下拉组件
const zoomDropdown = () => {
  const MenuItem = Menu.Item;
  const Divider = Menu.Divider;

  return (
    <Menu className="menu">
      <MenuItem name="resetView" hotkey="Cmd+H" className="menuItem">
        重置窗口
      </MenuItem>
      {/* <MenuItem name="fitWindow" hotkey="Cmd+Shift+H" className="menuItem">
        Fit Window
      </MenuItem> */}
      <Divider />
      <MenuItem name="25" className="menuItem">
        25%
      </MenuItem>
      <MenuItem name="50" className="menuItem">
        50%
      </MenuItem>
      <MenuItem name="75" className="menuItem">
        75%
      </MenuItem>
      <MenuItem name="100" className="menuItem">
        100%
      </MenuItem>
      <MenuItem name="125" className="menuItem">
        125%
      </MenuItem>
      <MenuItem name="150" className="menuItem">
        150%
      </MenuItem>
      <MenuItem name="200" className="menuItem">
        200%
      </MenuItem>
      <MenuItem name="300" className="menuItem">
        300%
      </MenuItem>
      <MenuItem name="400" className="menuItem">
        400%
      </MenuItem>
    </Menu>
  );
};


interface props {
  graph: Graph;
  projectid: string;
  projectName: string;
  setMiniVisible: (param: boolean) => void;
  miniVisible: boolean;
  /** 移动端轻客户端模式：渲染紧凑顶栏（返回/保存/预览），隐藏桌面工具条 */
  isMobile?: boolean;
}

const ToolBar = (props: props) => {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [visible, setVisible] = useState<boolean>(false)
  const [scale, setScale] = useState<string>('100%')
  const navigate = useNavigate();
  const { mutateAsync: saveEditorData } = useSaveEditorData();
  const { mutateAsync: createShare } = useCreateShare();
  let result!: fromjsonData[];
  const graph = props.graph;

  // 获取后端数据
  const { data } = useGetEditorData({ projectId: props.projectid });
  if (data?.data) {
    const { editorData } = data.data;
    result = editorData;
  }
  // 快捷键统一在下方 useEffect 中绑定（原先直接写在组件函数体内，
  // 每次重渲染都会重复绑定，且组件卸载后不会解绑）
  useEffect(() => {
    const graph = props.graph;
    const history = graph.history;
    setCanUndo(history.canUndo());
    setCanRedo(history.canRedo());
    const onHistoryChange = () => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    };
    history.on("change", onHistoryChange);
    return () => {
      history.off("change", onHistoryChange);
    };
  }, [props.graph]);
  const projectJson = () => {
    graph.getNodes().forEach((item: { removeTools: () => void }) => {
      item.removeTools();
    });
    const x6JSON = graph.toJSON();
    const newX6Json = x6JSON.cells.map((item: any) => {
      if (item.shape === "image") {
        const url = item?.attrs?.image["xlink:href"];
        let imgName;
        if (typeof url === "string") {
          const imgArr = url?.split("/");
          const length = imgArr.length;
          imgName = imgArr[length - 1].split('.')[0];
        }
        if (item.attrs) {
          item.attrs.image["xlink:href"] = imgName;
        }
      }
      return item;
    });
    return newX6Json;
  };
  const syncScaleLabel = () => {
    setScale(`${Math.round(graph.zoom() * 100)}%`);
  };
  // 快捷键绑定：仅在 graph / 项目信息变化时绑定一次，卸载时解绑，避免重复绑定与泄漏
  useEffect(() => {
    const keys = ['ctrl+s', 'ctrl+z', 'ctrl+c', 'ctrl+v', 'ctrl+=', 'ctrl+ -'];
    // 保存失败已由 useSaveEditorData 的 onError 统一提示，这里仅捕获避免 unhandled rejection
    const saveQuietly = () => {
      saveEditorData({
        projectId: props.projectid,
        projectName: props.projectName,
        editorData: projectJson(),
      }).catch(() => undefined);
    };
    graph.bindKey('ctrl+s', () => {
      saveQuietly();
      return false;
    });
    // 撤销
    graph.bindKey('ctrl+z', () => {
      graph.history.undo();
      return false;
    });
    // 复制
    graph.bindKey('ctrl+c', () => {
      const cells_copy = graph.getSelectedCells();
      if (cells_copy.length) {
        graph.copy(cells_copy);
      }
      return false;
    });
    // 粘贴
    graph.bindKey('ctrl+v', () => {
      if (!graph.isClipboardEmpty()) {
        const cells_paste = graph.paste({ offset: 32 });
        // 修改ID为8位数
        cells_paste[0].setProp("id", getUid(8));
        // 更新数据库数据，并刷新
        saveQuietly();
        graph.cleanSelection();
        graph.select(cells_paste);
      }
      return false;
    });
    // 放大/缩小：以当前缩放为基准计算目标值后使用 zoomTo 绝对缩放
    graph.bindKey("ctrl+=", () => {
      graph.zoomTo(graph.zoom() + 0.1);
      syncScaleLabel();
      return false;
    });
    graph.bindKey('ctrl+ -', () => {
      graph.zoomTo(Math.max(graph.zoom() - 0.1, 0.01));
      syncScaleLabel();
      return false;
    });
    return () => {
      graph.unbindKey(keys);
    };
  }, [graph, props.projectid, props.projectName, saveEditorData]);
  // V1.1 生成免登录分享链接：内容取最近一次保存版本；复制失败降级弹窗手动复制
  const shareCurrentProject = () => {
    createShare(props.projectid)
      .then(async (response) => {
        const shareToken = response?.data?.shareToken;
        if (!shareToken) return;
        const shareUrl = `${window.location.origin}/share/${shareToken}`;
        const copied = await copyText(shareUrl);
        if (copied) {
          notification.success({
            message: '分享链接已复制',
            description: '他人无需注册即可查看（内容为最近一次保存版本）',
          });
        } else {
          Modal.info({
            title: '复制失败，请手动复制以下链接',
            content: <Input readOnly value={shareUrl} style={{ marginTop: 8 }} />,
          });
        }
      })
      .catch(() => undefined); // 创建失败已由 useCreateShare 的 onError 统一提示
  };
  const handleClick = (name: string) => {
    switch (name) {
      case "undo":
        graph.history.undo();
        break;
      case "redo":
        graph.history.redo();
        break;
      case "resetView":
        graph.zoomTo(1);
        graph.centerContent();
        setScale('100%');
        break;
      case "25":
        graph.zoomTo(0.25);
        setScale('25%')
        break;
      case "50":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('50%')
        break;
      case "75":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('75%')
        break;
      case "100":
        graph.zoomTo(1);
        setScale('100%')
        break;
      case "125":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('125%')
        break;
      case "150":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('150%')
        break;
      case "200":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('200%')
        break;
      case "300":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('300%')
        break;
      case "400":
        graph.zoomTo(parseInt(name, 10) / 100);
        setScale('400%')
        break;
      case "zoomIn":
        graph.zoomTo(graph.zoom() + 0.1);
        syncScaleLabel();
        break;
      case "zoomOut":
        graph.zoomTo(Math.max(graph.zoom() - 0.1, 0.01));
        syncScaleLabel();
        break;
      case "preview": {
        // 与后端已保存数据对比：不一致则提示保存，一致则直接跳转预览。
        // 原实现中 isSave 被赋值三次（前两次结果均被覆盖），属死逻辑，已收敛为单次判断。
        const localResult = projectJson();
        const isSaved = _.isEqual(result, localResult);
        if (!isSaved) {
          setVisible(true);
        } else {
          window.open(`/preview/${props.projectid}`, "_self");
        }
        break;
      }
      case "save":
        saveEditorData({
          projectId: props.projectid,
          projectName: props.projectName,
          editorData: projectJson(),
        }).catch(() => undefined);
        break;
      case 'minimap':
        props.setMiniVisible(!props.miniVisible);
        break;
      case 'share':
        // 分享内容取已保存版本，异步执行不阻塞工具栏交互
        shareCurrentProject();
        break;
      case 'exportPng':
      case 'exportSvg': {
        // 导出前清理交互态（悬浮删除按钮/选中框/工具），保证导出画面干净
        graph.getNodes().forEach((item: { removeTools: () => void }) => {
          item.removeTools();
        });
        graph.cleanSelection();
        const filename = props.projectName || 'yutu-diagram';
        const task = name === 'exportPng' ? exportPng(graph, filename) : exportSvg(graph, filename);
        task
          .then(() => notification.success({ message: `已导出 ${name === 'exportPng' ? 'PNG' : 'SVG'}：${filename}` }))
          .catch(() => notification.error({ message: '导出失败，请重试' }));
        break;
      }
      default:
        break;
    }
  };
  // 确认保存弹出框的方法
  const save = () => {
    const mutation = saveEditorData({
      projectId: props.projectid,
      projectName: props.projectName,
      editorData: projectJson(),
    })
    mutation.then((response) => {
      if (response.message === '保存成功') {
        setVisible(false)
        window.open(`/preview/${props.projectid}`, "_self")
      }
    }).catch(() => undefined)
  }
  const noSave = () => {
    setVisible(false)
    window.open(`/preview/${props.projectid}`, "_self")
  }
  // 移动端保存：原地保存并给出成功反馈，不跳转（预览入口单独提供）
  const saveMobile = () => {
    saveEditorData({
      projectId: props.projectid,
      projectName: props.projectName,
      editorData: projectJson(),
    })
      .then((response) => {
        if (response.message === '保存成功') {
          notification.success({ message: '已保存', description: '点击「预览」可查看与导出图表' });
        }
      })
      .catch(() => undefined);
  };

  // 未保存确认弹窗（桌面/移动共用）
  const unsavedModal = (
    <Modal
      visible={visible}
      title="您本次编辑未进行保存"
      transitionName=""
      maskTransitionName=""
      footer={[
        <Button key="save" type="primary" onClick={save}>
          保存
        </Button>,
        <Button key="noSave" type="dashed" onClick={noSave}>
          不保存
        </Button>,
        <Button
          key='cancel'
          onClick={() => {
            setVisible(false);
          }}
        >
          取消
        </Button>,
      ]}
    >
      如果不进行保存,本次的编辑将会消失
    </Modal>
  );

  // 移动端轻客户端：紧凑顶栏（返回 / 项目名 / 保存 / 预览），画布与 AI 全屏对话为主角
  if (props.isMobile) {
    return (
      <div>
        <div className="yt-editor-mobile-bar">
          <Button
            type="text"
            size="small"
            aria-label="返回项目列表"
            icon={<ArrowLeftOutlined style={{ color: "var(--yt-text-secondary)" }} />}
            onClick={() => navigate("/")}
          />
          <span className="yt-mono yt-editor-mobile-name" title={props.projectName}>
            {props.projectName}
          </span>
          <span style={{ flex: 1 }} />
          <Button size="small" icon={<SaveOutlined />} onClick={saveMobile}>
            保存
          </Button>
          <Button size="small" icon={<ShareAltOutlined />} onClick={shareCurrentProject}>
            分享
          </Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleClick("preview")}>
            预览
          </Button>
        </div>
        {unsavedModal}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          position: "fixed",
          top: "10px",
          left: "16px",
          zIndex: 200,
        }}
      >
        <Toolbar hoverEffect size="small" onClick={handleClick}>
          <Group>
            <Item
              name="zoom"
              tooltipAsTitle={true}
              tooltip="Zoom (Alt+Mousewheel)"
              dropdown={zoomDropdown()}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 40,
                  textAlign: "right",
                }}
              >
                {scale}
              </span>
            </Item>
          </Group>
          <Group>
            <Item
              name="zoomIn"
              tooltip="Zoom In (Ctrl +)"
              icon={<ZoomInOutlined />}
            />
            <Item
              name="zoomOut"
              tooltip="Zoom Out (Ctrl -)"
              icon={<ZoomOutOutlined />}
            />
          </Group>
          <Group>
            <Item
              name="undo"
              tooltip="撤销 ( Ctrl + Z)"
              icon={<UndoOutlined />}
              disabled={!canUndo}
            />
            <Item
              name="redo"
              tooltip="重做"
              icon={<RedoOutlined />}
              disabled={!canRedo}
            />
          </Group>
          <Group>
            <Item name="save" tooltip="保存(Ctrl+s)" icon={<SaveOutlined />} />
          </Group>
          <Group>
            <Item name="preview" tooltip="预览" icon={<EyeOutlined />} />
          </Group>
          <Group>
            <Item name="exportPng" tooltip="导出 PNG（白底 2x，适配文档/PPT）" icon={<DownloadOutlined />} />
            <Item name="exportSvg" tooltip="导出 SVG（矢量无损，透明背景）" icon={<FileTextOutlined />} />
          </Group>
          <Group>
            <Item name="minimap" tooltip="小地图" icon={<Icon type="icon-minimap" />} />
          </Group>
          <Group>
            <Item name="share" tooltip="生成免登录分享链接（他人无需注册即可查看）" icon={<ShareAltOutlined />} />
          </Group>
        </Toolbar>

        {unsavedModal}
      </div>
      {/* 项目名：等宽字玻璃徽章（Neon Dark） */}
      <div
        className="yt-mono"
        style={{
          position: "fixed",
          top: "12px",
          left: "560px",
          zIndex: 200,
          maxWidth: 320,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          padding: "4px 14px",
          borderRadius: 8,
          background: "rgba(16, 24, 44, 0.82)",
          border: "1px solid var(--yt-border)",
          color: "var(--yt-text-primary)",
          fontSize: 13,
        }}
        title={props.projectName}
      >
        {props.projectName}
      </div>
    </div>

  );
};
export default ToolBar;
