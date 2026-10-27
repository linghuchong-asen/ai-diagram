/*
 * @Description: 注册页面 —— Neon Dark 科技感版本（与登录页同一设计语言）
 * 快赢批次一改造：
 *   - 注册请求携带渠道归因码 channel（入口 ?ch=/utm_source 捕获，register 埋点用）；
 *   - 支持 ?redirect= 回跳：注册成功 → 登录页（透传 redirect）→ 登录后回原目标页，
 *     保证「分享页 → 注册 → 登录 → 回分享页」转化动线不断链。
 * 邀请裂变批次改造：
 *   - 新增「邀请码（选填）」输入框：?ic= 捕获自动回填，注册成功双方得奖
 *     （邀请人 +1 天会员 / 新用户 +2 次生成）；非法码由后端白名单静默忽略。
 */
import { Button, Checkbox, Form, Input } from "antd";
import { GiftOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import { useRegister } from "./server";
import BrandTitle from "../legal/brand";
import { readChannel, readInviteCode, readShareSource } from "../../utils/channel";

const Register = () => {

  // 回跳地址（分享页等入口带入）：注册成功后经登录页透传回去
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") ?? undefined;
  const { mutateAsync: register } = useRegister(redirect)
  const onFinish = (values: any) => {
    // 协议勾选（agreement）仅为前端表单校验字段，不随注册请求提交
    const { username, password, inviteCode } = values;
    // 渠道归因码（可能为 undefined，后端按可选字段处理）
    const channel = readChannel();
    // 邀请码：表单回填优先（?ic= 捕获），清洗空串后随请求提交
    const code = typeof inviteCode === "string" ? inviteCode.trim() : "";
    // 分享归因（share-attribution-batch）：来自分享页的注册回传来源 token
    const shareToken = readShareSource();
    // 注册失败已由 useRegister 的 onError 统一提示，此处仅捕获避免 unhandled rejection
    register({
      username,
      password,
      ...(channel ? { channel } : {}),
      ...(code ? { inviteCode: code } : {}),
      ...(shareToken ? { shareToken } : {}),
    }).catch(() => undefined)
  };

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px 16px",
        overflow: "hidden",
      }}
    >
      {/* 氛围背景：网格 + 光晕 + 扫描光束 */}
      <div className="yt-atmo" />

      {/* 玻璃注册卡片（1px 渐变描边） */}
      <div
        className="yt-glass-border"
        style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 400, padding: "40px 36px 26px" }}
      >
        <Form
          name="register"
          initialValues={{ remember: true, inviteCode: readInviteCode() ?? "" }}
          onFinish={onFinish}
          requiredMark={false}
        >
          <BrandTitle />
          <Form.Item
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input
              size="large"
              prefix={<UserOutlined style={{ color: "var(--yt-text-muted)" }} />}
              placeholder="设置用户名"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 6, max: 64, message: "密码长度需为 6-64 位" },
            ]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined style={{ color: "var(--yt-text-muted)" }} />}
              placeholder="设置密码（6-64 位）"
            />
          </Form.Item>
          {/* 邀请码（选填）：?ic= 链接落地自动回填；非法码由后端白名单静默忽略 */}
          <Form.Item
            name="inviteCode"
            style={{ marginBottom: 14 }}
            rules={[
              { max: 16, message: "邀请码最长 16 位" },
              { pattern: /^[A-Za-z0-9]*$/, message: "邀请码仅限字母与数字" },
            ]}
          >
            <Input
              size="large"
              prefix={<GiftOutlined style={{ color: "var(--yt-text-muted)" }} />}
              placeholder="邀请码（选填，好友得奖励）"
            />
          </Form.Item>
          <Form.Item
            name="agreement"
            valuePropName="checked"
            style={{ marginBottom: 14 }}
            rules={[
              {
                validator: (_, value) =>
                  value === true
                    ? Promise.resolve()
                    : Promise.reject(new Error("请先阅读并同意协议")),
              },
            ]}
          >
            <Checkbox style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>
              我已阅读并同意{" "}
              <a href="/agreement" target="_blank" rel="noopener noreferrer">《用户服务协议》</a>{" "}
              与 <a href="/privacy" target="_blank" rel="noopener noreferrer">《隐私政策》</a>
            </Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 14 }}>
            <Button
              block
              size="large"
              type="primary"
              className="yt-btn-primary"
              htmlType="submit"
            >
              创 建 账 号
            </Button>
          </Form.Item>
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--yt-text-muted)" }}>
            已有账号？
            <Link
              to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"}
              style={{ marginLeft: 4 }}
            >
              去登录
            </Link>
          </div>
        </Form>
      </div>

      {/* 卡片下方：产品能力等宽标语 */}
      <div
        className="yt-mono"
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 26,
          fontSize: 11,
          color: "var(--yt-text-muted)",
          letterSpacing: "0.26em",
          textAlign: "center",
        }}
      >
        免费公测 · 每日额度 · 即刻开画
      </div>
    </div>
  );
};

export default Register;
