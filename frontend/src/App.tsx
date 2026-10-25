/*
 * @Author: yangsen
 * @Date: 2022-04-06 11:31:01
 * @LastEditTime: 2024-11-26 18:44:57
 * @Description: file content
 */

import "./App.css";
// antd 4 官方暗色组件样式（科技感改造：深色基底 + 自研 Neon Dark 主题层）
import "antd/dist/antd.dark.css";
// 语图 Neon Dark 设计系统：必须在 antd.dark.css 之后引入，覆盖优先
import "./theme/tech-theme.css";
import { ErrorBoundary } from "./components/error-boundary";
import { FullpageErrorFallback } from "./components/lib";
import { RouterPage } from "./router/routes";
function App() {
  return (
    <ErrorBoundary fallbackRender={FullpageErrorFallback}>
      <div className="App">
        <RouterPage />
      </div>
    </ErrorBoundary>
  );
}

export default App;
