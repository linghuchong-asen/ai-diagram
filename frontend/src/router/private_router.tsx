import { Navigate, useLocation } from "react-router-dom";
import React, { useEffect, useMemo } from "react";
import { notification } from "antd";

/** 校验 localStorage 中的 JWT 是否仍在有效期（payload.exp > 当前秒级时间戳）；格式异常视为无效 */
export const isTokenValid = (token: string) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    // exp是jwt payload中的一个字段，表示到期时间，是一个时间戳，单位秒
    return payload.exp > currentTime;
  } catch (err) {
    console.error(err)
    return false
  }
};

/** 登录鉴权组件 */
export const PrivateRoute: React.FC<{ component: React.ComponentType }> = ({ component: Component }) => {

  const location = useLocation();
  const token = localStorage.getItem("Authorization");
  const isValidToken = useMemo(() => token ? isTokenValid(token) : false, [token]);
  // 登录超时提示放到 useEffect：避免渲染期间产生副作用（严格模式下会重复弹出）
  useEffect(() => {
    if (token && !isValidToken) {
      notification['info']({ message: '登录超时，请重新登录' });
    }
  }, [token, isValidToken]);
  if (!token) {
    // 用户未登录，重定向到登录页面
    // location对象上记录有当前的路由信息，以便后续登录成功后跳转回该页面
    return <Navigate to="/login" state={{ from: location }} replace />
  } else if (!isValidToken) {
    // 用户登录超时，重定向到登录页面
    return <Navigate to="/login" state={{ from: location }} replace />
  } else {
    // 用户已登录，显示目标组件
    return < Component />
  }
};

