/*
 * @Author: yangsen
 * @Date: 2022-04-13 10:00:33
 * @LastEditTime: 2026-10-20
 * @Description: 首页（我的图集）—— Neon Dark 科技感版本
 */

import { ExclamationCircleOutlined, RocketOutlined, UploadOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Form, Input, Modal, notification, Space, Table, Upload } from "antd";
import { useForm } from "antd/lib/form/Form";
import TextArea from "antd/lib/input/TextArea";
import { UploadFile } from "antd/lib/upload/interface";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";
import { readTrialDraft, type TrialDraft } from "../../utils/trialIdentity";
// 会员到期横幅（vip-renewal-reminder-batch 扩展）：已登录首页顶部的续费双触点之一
import { VipExpiryBanner } from "../shared/VipExpiryBanner";
import {
  GetProjectQueryData,
  ProjectSearchItem,
  useAddProject,
  useDeleteProject,
  useGetDownload,
  useGetProject,
  useImportProject,
  useSearchProjects
} from "./server";

const { Search } = Input;


export interface tableDataProp {
  projectName: string;
  projectDesc: string;
  projectId: string;
  rowNum: number;
}

export const HomePage = () => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [params, setParams] = useState({ pageSize: 10, pageNumber: 1 });
  const [localVisible, setLocalVisible] = useState<boolean>(false)
  const [importId, setImportId] = useState<string>()
  const [fileList, setFileList] = useState<UploadFile<unknown>[]>([]);
  const { data: projectListResponse, isSuccess, isFetching } = useGetProject(params);
  const { mutateAsync: DownloadRequest } = useGetDownload();
  const { confirm } = Modal;
  const navigate = useNavigate();

  // 试用草稿继承（增长方案）：试用页「应用到画布」后暂存于 localStorage，
  // 登录进首页时在列表上方提示一键继承 → 新建项目 → 跳编辑器 ?draft=1 应用草稿
  const [trialDraft, setTrialDraft] = useState<TrialDraft | null>(null);
  const [draftOpening, setDraftOpening] = useState(false);

  useEffect(() => {
    setTrialDraft(readTrialDraft());
  }, []);

  const openTrialDraft = async () => {
    if (!trialDraft || draftOpening) return;
    setDraftOpening(true);
    try {
      const response = await mutateAsync({
        projectName: "我的试用图",
        projectDesc: trialDraft.prompt.slice(0, 100),
      });
      // POST /project 返回新项目实体（ClassSerializerInterceptor 暴露 projectId 字段名）
      const projectId = (response?.data as unknown as { projectId?: string })?.projectId;
      if (!projectId) throw new Error("新建项目未返回 projectId");
      // 草稿不在首页删除：navigate 是异步的，须由编辑器 ?draft=1 消费成功后统一清理（防竞态丢草稿）
      // 照抄 preView 页「继续编辑」的跳转写法，URL 追加 ?draft=1 供编辑器应用草稿
      navigate(`/editor/${projectId}/${encodeURIComponent("我的试用图")}?draft=1`);
    } catch {
      // 新建失败已由 useAddProject 的 onError（onErrorTips）统一提示，此处仅捕获避免 unhandled rejection
    } finally {
      setDraftOpening(false);
    }
  };

  // 全文检索：输入框受控值 + 300ms 防抖后的生效关键词
  const [searchText, setSearchText] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSearching = searchKeyword.length > 0;
  const {
    data: searchResponse,
    isSuccess: isSearchSuccess,
    isFetching: isSearchFetching
  } = useSearchProjects(searchKeyword);

  const onSearchInputChange = (value: string) => {
    setSearchText(value);
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setSearchKeyword(value.trim());
    }, 300);
  };

  // 回车/点击搜索按钮：跳过防抖立即检索
  const onSearchNow = (value: string) => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSearchText(value);
    setSearchKeyword(value.trim());
  };

  // 卸载时清理未触发的防抖定时器（在途检索请求由 useSearchProjects 内部取消）
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);




  let tableSource: GetProjectQueryData["data"] = {
    page: { total: 0, pageSize: 1 },
    tableData: [],
  };

  if (isSearching) {
    const list: ProjectSearchItem[] = isSearchSuccess ? searchResponse?.data.list ?? [] : [];
    tableSource = {
      page: { total: isSearchSuccess ? searchResponse?.data.total ?? list.length : 0, pageSize: list.length || 1 },
      tableData: list.map((item, index) => ({ ...item, rowNum: index + 1 })),
    };
  } else if (isSuccess) {
    const { page, tableData } = projectListResponse.data;
    tableSource = { ...tableSource, page, tableData };
  }

  const [form] = useForm();

  const { mutateAsync } = useAddProject();
  const { mutateAsync: deleteProject } = useDeleteProject();

  const showModal = () => {
    setIsModalVisible(true);
  };
  const onChange = (pageNumber: number, pageSize: number) => {
    setParams({ pageNumber, pageSize });
  };
  const onDelProject = (projectId: string) => {
    deleteProject({ projectIds: [projectId] });
  };
  // 导入本地JSON接口
  const { mutateAsync: importJson } = useImportProject(setLocalVisible, setFileList, form);

  // 删除确认对话框
  const showDeleteConfirm = (projectId: string, projectName: string): void => {
    confirm({
      title: `请确认是否删除 ${projectName} 项目?`,
      icon: <ExclamationCircleOutlined />,
      content: '',
      okText: '是',
      okType: 'primary',
      cancelText: '否',
      onOk() {
        onDelProject(projectId);
      },
      onCancel() {
        // 用户取消删除，无需处理
      },
    });
  }

  return (
    <div className="yt-home-wrap" style={{ position: "relative", minHeight: "100vh", padding: "28px 32px 48px" }}>
      {/* 氛围背景：网格 + 光晕 + 扫描光束 */}
      <div className="yt-atmo" />

      {/* 顶部品牌栏 */}
      <PageHeader>
        <BrandLogoSmall subtitle="YUTU · AI DIAGRAM" />
        <div className="yt-mono" style={{ fontSize: 10, color: "var(--yt-text-muted)", letterSpacing: "0.22em" }}>
          V1.0 · FREE BETA
        </div>
      </PageHeader>

      {/* 会员到期/过期唤醒横幅（旁路数据，失败隐藏；续费双触点之一，另一在浮窗） */}
      <VipExpiryBanner />

      {/* 试用草稿提示条：注册登录后在项目列表上方引导一键继承试用作品 */}
      {trialDraft && (
        <DraftBanner className="yt-glass-border">
          <RocketOutlined style={{ color: "var(--yt-accent)", fontSize: 18, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--yt-text-primary)" }}>
              继续你的试用作品
            </div>
            <div
              title={trialDraft.prompt}
              style={{
                fontSize: 12,
                color: "var(--yt-text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {trialDraft.prompt ? `「${trialDraft.prompt}」生成的流程图` : "试用生成的流程图"}
            </div>
          </div>
          <Button type="primary" className="yt-btn-primary" loading={draftOpening} onClick={openTrialDraft}>
            打开
          </Button>
        </DraftBanner>
      )}

      {/* 图集主面板（玻璃卡片） */}
      <GlassPanel>
        <ToolbarRow>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--yt-text-primary)" }}>
            我的图集
          </div>
          <div style={{ flex: 1 }} />
          <Button
            type="primary"
            className="yt-btn-primary"
            onClick={() => {
              showModal();
            }}
          >
            新建项目
          </Button>
          <Button>
            <Link to="/outsys">导入外部系统</Link>
          </Button>
          <Search
            placeholder="搜索项目名称/内容"
            allowClear
            value={searchText}
            onChange={(e) => onSearchInputChange(e.target.value)}
            onSearch={onSearchNow}
            style={{ width: 240, marginLeft: 4 }}
          />
        </ToolbarRow>
        <Table
          loading={isSearching ? isSearchFetching : isFetching}
          rowKey="projectId"
          scroll={{ x: 720 }}
          dataSource={tableSource.tableData}
          locale={{
            emptyText: isSearching ? (
              "未找到匹配的项目名称/内容"
            ) : (
              <EmptyGuide>
                <GuideTitle>画布还是空的</GuideTitle>
                <GuideText>
                  点击「新建项目」开始绘制，或在编辑器中唤起 AI 助手，
                  <br />
                  一句话生成你的第一张流程图。
                </GuideText>
              </EmptyGuide>
            ),
          }}
          pagination={
            isSearching
              ? false
              : {
                  pageSize: tableSource.page.pageSize,
                  total: tableSource.page.total,
                  onChange: onChange,
                }
          }
          columns={[
            {
              title: "",
              dataIndex: "rowNum",
              width: 46,
              render: (text: number) => (
                <span className="yt-mono" style={{ color: "var(--yt-text-muted)", fontSize: 12 }}>
                  {String(text).padStart(2, "0")}
                </span>
              ),
            },
            {
              title: "项目名称",
              dataIndex: "projectName",
              render: (text: string) => (
                <span style={{ color: "var(--yt-text-primary)" }}>{text}</span>
              ),
            },
            ...(isSearching
              ? [
                  {
                    title: "命中内容",
                    dataIndex: "contentSnippet",
                    ellipsis: true,
                    render: (text: string) => (text ? text : "-"),
                  },
                ]
              : []),
            {
              title: "操作",
              render: (_, record) => (
                <Space size="middle" align="center">
                  <a href={`/preview/${record.projectId}`} target="_blank">
                    预览
                  </a>
                  <a href={`/editor/${record.projectId}/${record.projectName}`} target="_blank">
                    编辑
                  </a>
                  <a
                    onClick={async () => {
                      try {
                        const response = await DownloadRequest(record.projectId)
                        if (!response) return
                        const blobUrl = window.URL.createObjectURL(response.data);

                        const a = document.createElement("a");
                        a.href = blobUrl;
                        const disposition = response.responseHeaders['content-disposition'];
                        const fileName = disposition?.includes('filename=')
                          ? disposition.split('filename=')[1].replace(/['"]/g, '')
                          : undefined;
                        a.download = fileName || "editDataFile.json"; // 设置文件名
                        a.click();
                        URL.revokeObjectURL(blobUrl);
                      } catch {
                        // 下载失败已由 useGetDownload 的 onError 统一提示，此处仅捕获避免 unhandled rejection
                      }
                    }}
                  >
                    导出
                  </a>
                  <a onClick={() => showDeleteConfirm(record.projectId, record.projectName)}>
                    删除
                  </a>
                  <a
                    onClick={() => {
                      setLocalVisible(true);
                      setImportId(record.projectId)
                    }}
                  >
                    导入
                  </a>
                </Space>
              ),
            },
          ]}
        />
      </GlassPanel>
      <PopPage
        title="新建项目"
        callback={async () => {
          try {
            const params = form.getFieldsValue();
            await mutateAsync(params);
            form.resetFields();
          } catch {
            // 新建失败已由 useAddProject 的 onError 统一提示，此处仅捕获避免 unhandled rejection
          }
        }}
        isModalVisible={isModalVisible}
        setIsModalVisible={setIsModalVisible}
      >
        <Form form={form}>
          <Form.Item label="项目名称" name="projectName">
            <Input placeholder="例如：用户增长漏斗" />
          </Form.Item>
          <Form.Item label="项目描述" name="projectDesc">
            <TextArea showCount maxLength={100} placeholder="一句话描述这张图的用途（可选）" />
          </Form.Item>
        </Form>
      </PopPage>
      <Modal
        visible={localVisible}
        title="导入本地json数据"
        okText="导入"
        cancelText="取消"
        onCancel={() => {
          setLocalVisible(false)
        }}
        onOk={() => {
          form
            .validateFields()
            .then((values) => {
              const reader = new FileReader();
              reader.readAsArrayBuffer(values.localJson.file);
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
                  const resultArr = JSON.parse(resultString); // resultArr是转换完成要传给后端的JSON数组
                  importJson({
                    projectId: importId,
                    editData: resultArr,
                  })
                } catch (error) {
                  // 文件解析失败（非合法 JSON 等）：明确提示，而不是静默失败
                  notification["error"]({
                    message: "文件解析失败",
                    description: error instanceof Error ? error.message : String(error),
                  });
                }
              }

            })
            .catch((info) => {
              notification["error"]({
                message: "发生错误",
                description: info.toString(),
              });
            });
        }}
        transitionName=""
        maskTransitionName=""
      >
        <Form
          form={form}
          layout="vertical"
          name="form_import"
        >
          <Form.Item
            name='localJson'
            style={{ marginBottom: 0 }}
            rules={[
              {
                required: true,
                message: '请上传文件',
              },
            ]}
          >
            <Upload
              beforeUpload={(file) => { setFileList([file]); return false }}
              fileList={fileList}
            >
              <Button icon={<UploadOutlined />}>本地X6JSON导入</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div >
  );
};
interface PopPagePro {
  title: string;
  callback: () => void;
  children: ReactNode;
  isModalVisible: boolean;
  setIsModalVisible: (params: boolean) => void;
}
const PopPage = ({ title, callback, children, isModalVisible, setIsModalVisible }: PopPagePro) => {
  const handleOk = () => {
    callback();
    setIsModalVisible(false);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };
  return (
    <Modal
      title={title}
      visible={isModalVisible}
      onOk={handleOk}
      onCancel={handleCancel}
      transitionName=""
      maskTransitionName=""
    >
      {children}
    </Modal>
  );
};

/** 顶部品牌栏：左右分布（品牌 logo + 版本等宽标签） */
const PageHeader = styled.header`
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  @media (max-width: 768px) {
    margin-bottom: 14px;
  }
`;

/** 试用草稿提示条：玻璃横幅（图标 + 标题/副文案 + 打开按钮） */
const DraftBanner = styled.div`
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-radius: 14px;
  @media (max-width: 768px) {
    margin-bottom: 12px;
    padding: 12px 14px;
    gap: 10px;
  }
`;

/** 图集玻璃主面板 */
const GlassPanel = styled.div`
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px 26px 12px;
  background: var(--yt-glass);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--yt-border);
  border-radius: 16px;
  box-shadow: 0 12px 48px rgba(2, 6, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  @media (max-width: 768px) {
    padding: 14px 14px 8px;
    border-radius: 12px;
  }
`;

/** 工具行：标题 + 操作区 + 搜索 */
const ToolbarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;

/** 空状态引导 */
const EmptyGuide = styled.div`
  padding: 36px 0 40px;
  text-align: center;
`;
const GuideTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: var(--yt-text-primary);
  margin-bottom: 10px;
`;
const GuideText = styled.div`
  font-size: 13px;
  color: var(--yt-text-muted);
  line-height: 1.8;
`;
