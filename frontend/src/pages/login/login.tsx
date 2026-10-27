/*
 * @Description: 登录页面 —— Neon Dark 科技感版本（氛围背景 + 玻璃渐变描边卡片）
 * 快赢批次一(QW2)：登录后回跳地址支持双通道 —— location.state.from（PrivateRoute 拦截写入）
 * 与 ?redirect= 查询参数（分享页「复制这张图」等入口写入），查询参数优先，
 * 保证「分享页 → 登录/注册 → 回分享页」的转化动线不断链。
 * @Author: yangsen
 * @Date: 2024-11-26 09:53:12
 * @LastEditors: yangsen
 * @LastEditTime: 2026-10-26
 */
import { Form, Input, Button } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useLogin } from "./server";
import { Link, useLocation } from "react-router-dom";
import BrandTitle from "../legal/brand";

const Login = () => {

  const location = useLocation();
  // 回跳地址：?redirect= 优先（URL 显式携带，跨登录/注册页传递），其次 PrivateRoute 的 state.from
  const redirectParam = new URLSearchParams(location.search).get("redirect");
  const stateFrom = (location.state as { from?: { pathname: string } })?.from?.pathname;
  const from = redirectParam || stateFrom || "/";
  const { mutateAsync: loginRequest } = useLogin(from);
  const onFinish = (values: any) => {
    // 登录失败已由 useLogin 的 onError 统一提示，此处仅捕获避免 unhandled rejection
    loginRequest(values).catch(() => undefined)
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

      {/* 玻璃登录卡片（1px 渐变描边） */}
      <div
        className="yt-glass-border"
        style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 400, padding: "40px 36px 26px" }}
      >
        <Form
          name="login"
          initialValues={{ remember: true }}
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
              placeholder="用户名"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined style={{ color: "var(--yt-text-muted)" }} />}
              placeholder="密码"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 14, marginTop: 6 }}>
            <Button
              block
              size="large"
              type="primary"
              className="yt-btn-primary"
              htmlType="submit"
            >
              登 录
            </Button>
          </Form.Item>
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--yt-text-muted)" }}>
            还没有账号？
            {/* 带 redirect 时透传给注册页：注册 → 登录 → 原目标页，动线不断链 */}
            <Link
              to={redirectParam ? `/register?redirect=${encodeURIComponent(redirectParam)}` : "/register"}
              style={{ marginLeft: 4 }}
            >
              立即注册
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
        流式生成 · 人工确认 · 画布级编辑
      </div>

      {/* 底部协议 */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 12,
          fontSize: 12,
          color: "var(--yt-text-muted)",
          textAlign: "center",
        }}
      >
        登录/注册即代表你已阅读并同意
        <a href="/agreement" target="_blank" rel="noopener noreferrer">《用户服务协议》</a>与
        <a href="/privacy" target="_blank" rel="noopener noreferrer">《隐私政策》</a>
      </div>
    </div>
  );
};

export default Login;
