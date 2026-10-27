/*
 * @Description: 应用路由表
 * 公开页（勿加 PrivateRoute）：/trial 试用、/templates 模板、/share/:token 分享、
 *   /fun 脑洞显影卡、/digest 一图看懂（魔性传播批次一新增的两个获客入口）、
 *   /unlock-result 支付回跳、/mock-pay 沙箱收银台（商业化闭环批次）。
 * 受保护页经 PrivateRoute（未登录跳登录并携带来源）。
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
import { FunPage } from "../pages/fun";
import { DigestPage } from "../pages/digest";
import { AnnualPage } from "../pages/annual";
import { MindPage } from "../pages/mind";
import { ScenariosIndexPage } from "../pages/scenarios/ScenariosIndexPage";
import { ScenarioPage } from "../pages/scenarios/ScenarioPage";
// 商业化闭环批次：支付回跳页 / 沙箱收银台 / 营收看板
import { UnlockResultPage } from "../pages/unlockResult";
import { MockPayPage } from "../pages/mockPay";
import { AdminRevenuePage } from "../pages/admin/revenue";
// 付费转化增强批次：公开价格页
import { PricingPage } from "../pages/pricing";
// 邀请裂变批次：邀请活动页（登录态）
import { InvitePage } from "../pages/invite";


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
        {/* 魔性传播批次一：脑洞显影卡（娱乐向获客前锋，公开页） */}
        <Route path="/fun" element={<FunPage />} />
        {/* 魔性传播批次一：一图看懂（实用向获客，粘贴文本生成总结图，公开页） */}
        <Route path="/digest" element={<DigestPage />} />
        {/* Round B：代码年报（GitHub/Gitee 公开数据年度报告卡，公开页） */}
        <Route path="/annual" element={<AnnualPage />} />
        {/* Round E：思维体质图（5 题测思维原型 → 生成画像图，公开页） */}
        <Route path="/mind" element={<MindPage />} />
        {/* 场景工厂：索引页 + 通用场景页（注册表驱动，新增场景零路由改动，公开页） */}
        <Route path="/scenarios" element={<ScenariosIndexPage />} />
        <Route path="/s/:scenarioId" element={<ScenarioPage />} />
        <Route path="/outsys/*" element={<PrivateRoute component={ImportOutSystem} />} />
        <Route path="/editor/:projectid/:projectName" element={<PrivateRoute component={X6Page} />} />
        <Route path="/preview/:projectid" element={<PrivateRoute component={PreViewPage} />} />
        {/* V1.1 公开分享页：免登录只读查看（增长回路落地页，勿加 PrivateRoute） */}
        <Route path="/share/:token" element={<SharePage />} />
        {/* 商业化闭环批次：支付完成回跳页（公开页，查单接口自身需 JWT） */}
        <Route path="/unlock-result" element={<UnlockResultPage />} />
        {/* 商业化闭环批次：沙箱收银台（仅 PAY_CHANNEL=mock 演示环境可达） */}
        <Route path="/mock-pay" element={<MockPayPage />} />
        {/* 付费转化增强批次：公开价格页（免费/单图/会员三卡对比 + 会员开通动线） */}
        <Route path="/pricing" element={<PricingPage />} />
        {/* 邀请裂变批次：邀请活动页（登录态，未登录经 PrivateRoute 带 redirect 回流） */}
        <Route path="/invite" element={<PrivateRoute component={InvitePage} />} />
        {/* 商业化闭环批次：营收看板（仅 role=root 账号，后端二次校验） */}
        <Route path="/admin/revenue" element={<PrivateRoute component={AdminRevenuePage} />} />
      </Routes>
    </BrowserRouter>
  );
};
