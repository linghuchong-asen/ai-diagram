/*
 * @Author: yangsen
 * @Date: 2022-04-19 10:22:33
 * @LastEditTime: 2022-04-19 11:00:41
 * @Description:contextTotal
 */
import { ReactNode } from "react";
import { QueryClientProvider, QueryClient } from "react-query";
// 国际化为中文显示
import zhCN from "antd/lib/locale/zh_CN";
import { ConfigProvider } from "antd";

// QueryClient 在模块级创建单例，避免组件每次渲染都新建 client（缓存会随之丢失）
const queryClient = new QueryClient();

export const AppProviders = ({ children }: { children: ReactNode }) => {
  return (
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ConfigProvider>
  );
};
