/*
 * @Description: 「一图看懂」实用型入口页（魔性传播批次一 · A1）
 * 粘贴文章/公告/说明文本 → AI 总结成一张流程图（免登录试用链路）。
 * 传播机制：实用即内容 —— 转发「一图看懂XX」的图卡让发送者显得有用，
 *   接收者按图索骥进入语图，形成「图即广告」的 Gamma 式循环。
 * 额度边界：匿名试用链路上限 500 字（与后端 TrialChatRequestSchema 一致）；
 *   页内明示「注册后可处理 2000 字」，把长文需求转化为注册动机。
 * Round F：支持上传 .txt/.md 文件 —— 客户端 FileReader 读取（不经服务器、不落盘），
 *   超过 500 字自动截断并提示注册解锁。
 * 埋点：提交记 digest_submit（经 /growth/track）。
 */

import { InboxOutlined, LinkOutlined, RocketOutlined, FileSearchOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input, notification, Upload } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";
import { clipToLimit, readTextFile } from "../../utils/textFile";
import { http } from "../../utils/http";

/** 匿名试用链路的 message 上限（后端 chat.schema TrialChatRequestSchema.max(500) */
const DIGEST_MAX_LENGTH = 500;

/** 示例填充（点击填入，降低空白页摩擦） */
const DIGEST_EXAMPLES: Array<{ label: string; text: string }> = [
  {
    label: "示例：报销制度",
    text: "把以下内容总结成一张流程图：员工报销需在费用发生后 30 天内提交申请并附发票，主管 3 个工作日内审批，金额超过 5000 元需总监复核，财务审核票据合规后 5 个工作日内打款，驳回需补充材料后重新提交。",
  },
  {
    label: "示例：入学流程",
    text: "把以下内容总结成一张流程图：新生收到录取通知书后在线确认入学，8 月底前完成缴费与宿舍选择，报到当天领取材料办理入住，参加入学教育与分班测试，测试通过进入对应班级，未通过参加补测。",
  },
];

export const DigestPage = () => {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  /** 文本被截断提示（上传长文件时置 true） */
  const [clipped, setClipped] = useState(false);
  /** Round J：链接抓取进行中 */
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [url, setUrl] = useState("");

  /** Round J：粘贴链接 → 后端抓正文 → 填充输入区（截断提示同文件上传） */
  const handleFetchUrl = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || fetchingUrl) return;
    setFetchingUrl(true);
    try {
      const response = await http<{ title: string; text: string; truncated: boolean }>(
        "/digest/url",
        { method: "post", params: { url: trimmedUrl } }
      );
      const fetched = response?.data;
      if (!fetched?.text) {
        notification.warning({ message: "没抓到正文", description: "该页面可能需要登录或是动态渲染，请直接粘贴文字" });
        return;
      }
      const { text, truncated } = clipToLimit(
        fetched.text.replace(/\r?\n/g, " ").trim(),
        DIGEST_MAX_LENGTH
      );
      setText(text);
      setClipped(truncated);
      notification.success({
        message: fetched.title ? `已读取：${fetched.title}` : "正文已读取",
        description: truncated ? `原文较长，已截取前 ${DIGEST_MAX_LENGTH} 字（注册后可处理 2000 字）` : undefined,
      });
    } catch (error) {
      notification.error({
        message: "链接读取失败",
        description: (error as { message?: string })?.message ?? "请检查链接或直接粘贴文字",
      });
    } finally {
      setFetchingUrl(false);
    }
  };

  /** 提交：拼总结指令跳试用页（浮窗自动首发） */
  const goDigest = () => {
    if (!trimmed) return;
    trackGrowthEvent("digest_submit");
    const prompt = `把以下内容总结成一张清晰的流程图（保留关键步骤、判断分支与角色）：${trimmed}`;
    navigate(`/trial?q=${encodeURIComponent(prompt)}`);
  };

  /** Round F：上传 txt/md → 客户端读取（不经服务器）→ 按 500 字截断填充 */
  const handleUploadFile = async (file: File) => {
    try {
      const content = await readTextFile(file);
      const { text, truncated } = clipToLimit(content.replace(/\r?\n/g, " ").trim(), DIGEST_MAX_LENGTH);
      setText(text);
      setClipped(truncated);
      if (truncated) {
        notification.info({
          message: `文件较长，已截取前 ${DIGEST_MAX_LENGTH} 字`,
          description: "注册登录后单次可处理 2000 字，支持更完整的总结。",
        });
      } else {
        notification.success({ message: "文件已读取" });
      }
    } catch (error) {
      notification.error({ message: "读取失败", description: (error as Error).message });
    }
  };

  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          DIGEST
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/fun" style={{ fontSize: 13, color: "var(--yt-text-secondary)", marginRight: 14 }}>
          脑洞显影卡 →
        </Link>
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            注册解锁更多
          </Button>
        </Link>
      </TopBar>

      <HeroPanel className="yt-glass-border">
        <HeroTag className="yt-mono">TEXT → ONE DIAGRAM</HeroTag>
        <HeroTitle>一图看懂任何说明文</HeroTitle>
        <HeroSubtitle>
          粘贴制度 / 通知 / 教程 / 公告 → 30 秒生成流程图 · 免登录免费试 2 次
        </HeroSubtitle>

        <InputArea>
          <Input.TextArea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setClipped(false);
            }}
            maxLength={DIGEST_MAX_LENGTH}
            showCount
            autoSize={{ minRows: 6, maxRows: 12 }}
            placeholder={"粘贴要「一图看懂」的内容，例如：\n报销制度、入学流程、售后政策、操作教程、会议纪要……"}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              color: "var(--yt-text-primary)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          />
          {/* Round J：链接抓取行 —— 粘贴文章/公告 URL 直接取正文 */}
          <UploadRow>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={handleFetchUrl}
              placeholder="或粘贴网页链接（http/https），一键提取正文"
              style={{ flex: 1, minWidth: 220 }}
              prefix={<LinkOutlined style={{ color: "var(--yt-text-muted)" }} />}
            />
            <Button loading={fetchingUrl} disabled={!url.trim()} onClick={handleFetchUrl}>
              读取正文
            </Button>
          </UploadRow>
          {/* Round F：txt/md 上传入口（客户端读取，不经服务器；ant Upload 仅作文件选择器） */}
          <UploadRow>
            <Upload
              accept=".txt,.md,.markdown"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleUploadFile(file);
                return false; // 阻止 antd 默认上传行为
              }}
            >
              <Button icon={<InboxOutlined />}>上传 .txt / .md 文件</Button>
            </Upload>
            {clipped && (
              <span style={{ fontSize: 12, color: "var(--yt-accent)" }}>
                已截取前 {DIGEST_MAX_LENGTH} 字 · 注册后可处理 2000 字
              </span>
            )}
          </UploadRow>
        </InputArea>

        <ActionRow>
          <Button
            type="primary"
            className="yt-btn-primary"
            size="large"
            icon={<FileSearchOutlined />}
            disabled={!trimmed}
            onClick={goDigest}
          >
            生成一张图看懂它
          </Button>
        </ActionRow>

        <ExampleRow>
          {DIGEST_EXAMPLES.map((example) => (
            <span
              key={example.label}
              className="yt-chip"
              title={example.text}
              onClick={() => setText(example.text)}
            >
              {example.label}
            </span>
          ))}
        </ExampleRow>

        <LimitHint>
          当前免登录可处理 {DIGEST_MAX_LENGTH} 字以内的文本；
          <Link to="/register" style={{ marginLeft: 4, color: "var(--yt-accent)" }}>
            注册后单次可处理 2000 字
          </Link>
          ，支持保存与继续编辑。
        </LimitHint>
      </HeroPanel>
    </PageWrap>
  );
};

/** 页面外层 */
const PageWrap = styled.div`
  position: relative;
  min-height: 100vh;
  padding: 28px 24px 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** 顶部小栏 */
const TopBar = styled.header`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 860px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 44px;
`;

/** 主卡 */
const HeroPanel = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 860px;
  padding: 44px 40px 36px;
  text-align: center;
  @media (max-width: 768px) {
    padding: 28px 18px 24px;
  }
`;

const HeroTag = styled.div`
  font-size: 10px;
  letter-spacing: 0.28em;
  color: var(--yt-accent);
  opacity: 0.85;
  margin-bottom: 16px;
`;

const HeroTitle = styled.h1`
  margin: 0 0 12px;
  font-size: 32px;
  font-weight: 600;?
  letter-spacing: -0.01em;
  color: var(--yt-text-primary);
  @media (max-width: 768px) {
    font-size: 22px;
  }
`;

const HeroSubtitle = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  margin-bottom: 28px;
`;

/** 大输入区 */
const InputArea = styled.div`
  text-align: left;
  .ant-input-data-count {
    color: var(--yt-text-muted);
  }
`;

/** 上传行：txt/md 文件入口 + 截断提示 */
const UploadRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
`;

/** 主按钮行 */
const ActionRow = styled.div`
  margin-top: 18px;
`;

/** 示例 chips */
const ExampleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
`;

/** 额度提示（把长文需求转化为注册动机） */
const LimitHint = styled.div`
  margin-top: 18px;
  font-size: 12px;
  color: var(--yt-text-muted);
`;
