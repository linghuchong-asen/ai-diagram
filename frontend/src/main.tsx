/*
 * @Description: 应用入口 —— 挂载 React 根组件与全局 Provider
 * 增长快赢批次一(QW1)：渲染前先做一次渠道参数捕获（?ch=/utm_source/from → localStorage），
 * 保证任何落地页（首页/试用/模板/分享页）带来的渠道码在后续注册时都能随请求提交。
 * 邀请裂变批次：同步捕获邀请码（?ic= → localStorage），注册时随请求提交完成归因。
 */
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App";
import { AppProviders } from "./context";
import { captureChannelOnce, captureInviteCodeOnce } from "./utils/channel";

// 渠道归因捕获：越早越好（用户可能在页面间跳转后才注册）
captureChannelOnce();
// 邀请码捕获：邀请链接（/register?ic=xxx）落地瞬间完成归因
captureInviteCodeOnce();

ReactDOM.render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
  document.getElementById("root")
);