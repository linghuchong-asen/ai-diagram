/*
 * @Description: 首页双态入口（增长方案）
 * 已登录（localStorage Authorization 且 JWT 有效）→「我的图集」HomePage；
 * 未登录 / 登录过期 → 增长落地页 LandingPage（免登录试用入口）。
 */

import { useMemo } from "react";
import { isTokenValid } from "../../router/private_router";
import { HomePage } from "./index";
import { LandingPage } from "./landing";

export const HomeEntry = () => {
  const token = localStorage.getItem("Authorization");
  const isValid = useMemo(() => (token ? isTokenValid(token) : false), [token]);
  return isValid ? <HomePage /> : <LandingPage />;
};
