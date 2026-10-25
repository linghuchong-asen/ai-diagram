/*
 * @Description: 注册页面 —— Neon Dark 科技感版本（与登录页同一设计语言）
 * @Author: yangsen
 * @Date: 2024-11-26 09:53:12
 * @LastEditors: yangsen
 * @LastEditTime: 2026-10-20
 */
import { Button, Checkbox, Form, Input } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useRegister } from "./server";
import { Link } from "react-router-dom";
import BrandTitle from "../legal/brand";

const Register = () => {

  const { mutateAsync: register } = useRegister()
  const onFinish = (values: any) => {
    // 协议勾选（agreement）仅为前端表单校验字段，不随注册请求提交
    const { username, password } = values;
    // 注册失败已由 useRegister 的 onError 统一提示，此处仅捕获避免 unhandled rejection
    register({ username, password }).catch(() => undefined)
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
            <Link to="/login" style={{ marginLeft: 4 }}>去登录</Link>
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
