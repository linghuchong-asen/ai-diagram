/*
 * @Author: yangsen
 * @Date: 2022-04-15 19:27:09
 * @LastEditTime: 2024-11-28 15:01:00
 * @Description: file content
 */

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomeEntry } from "../pages/home/entry";
import { ImportOutSystem } from "../pages/imoprtOutsystem";
import { PreViewPage } from "../pages/preView";
import { TrialPage } from "../pages/trial";
import { X6Page } from "../pages/x6Editor";
import Login from "../pages/login/login";
import { PrivateRoute } from "./private_router";
import Register from "../pages/login/register";
import { AgreementPage } from "../pages/legal/agreement";
import { PrivacyPage } from "../pages/legal/privacy";
import { SharePage } from "../pages/share";
import { TemplatesPage } from "../pages/templates";


export const RouterPage = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/login' element={<Login />} />
        <Route path='/register' element={<Register />} />
        <Route path='/agreement' element={<AgreementPage />} />
        <Route path='/privacy' element={<PrivacyPage />} />
        {/* 首页双态：已登录进「我的图集」，未登录进增长落地页（免登录试用入口） */}
        <Route path="/" element={<HomeEntry />} />
        {/* 免登录试用页：未登录走 /ai/trial/chat 试用链路；登录用户即普通生成入口（勿加 PrivateRoute） */}
        <Route path="/trial" element={<TrialPage />} />
        {/* 模板中心：公开页，承接社群/SEO 流量，一键生成跳 /trial（勿加 PrivateRoute） */}
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/outsys/*" element={<PrivateRoute component={ImportOutSystem} />} />
        <Route path="/editor/:projectid/:projectName" element={<PrivateRoute component={X6Page} />} />
        <Route path="/preview/:projectid" element={<PrivateRoute component={PreViewPage} />} />
        {/* V1.1 公开分享页：免登录只读查看（增长回路落地页，勿加 PrivateRoute） */}
        <Route path="/share/:token" element={<SharePage />} />
      </Routes>
    </BrowserRouter>
  );
};

