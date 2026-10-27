/*
 * @Description: 登录/注册接口封装
 * 快赢批次一改造：
 *   - 注册请求可携带 channel 渠道归因码（?ch=/utm_source 入口捕获，后端 register 埋点用，不落库）；
 *   - useRegister 支持 redirectTo：注册成功跳登录页时透传 ?redirect=（分享页「复制这张图」
 *     等入口的回跳动线：分享页 → 注册 → 登录 → 回分享页）。
 */
import { useMutation } from "react-query";
import { http } from "../../utils/http";
import { notification } from "antd";
import { useNavigate } from "react-router-dom";

interface ILoginParams {
  username: string;
  password: string;
  /** 快赢批次一(QW1)：注册渠道归因码（可选，仅用于 register 埋点） */
  channel?: string;
}

export const useLogin = (fromPath: string) => {
  const navigate = useNavigate();
  return useMutation(
    (params: ILoginParams) => http(`/auth/login`, { method: "post", params }),
    {
      onSuccess: (response) => {
        const { code, data, message } = response;
        if (code === 0) {
          notification["success"]({
            message: "提示",
            description: "登录成功！",
          });
          // 将token保存到localstorage中
          localStorage.setItem("Authorization", data as string);
          // 重定向到首页（或 ?redirect= 指定的回跳地址）
          navigate(fromPath);
        } else {
          notification["error"]({
            message: "发生错误",
            description: message,
          });
        }
      },
      onError: (error) => {
        // http() 统一抛 HttpError（无 response 字段），安全读取错误信息
        const err = error as { response?: { data?: { message?: string } }; message?: string };
        notification["error"]({
          message: "发生错误",
          description: err?.response?.data?.message ?? err?.message ?? "登录失败",
        });
      },
    }
  );
};

/**
 * 注册：redirectTo 存在时，注册成功跳 `/login?redirect=...`，登录后回到原目标页；
 *       未传时保持原行为（跳 /login）。
 */
export const useRegister = (redirectTo?: string) => {
  const navigate = useNavigate();
  return useMutation(
    (params: ILoginParams) => http(`user/register`, { method: "post", params }),
    {
      onSuccess: (response) => {
        const { code, data, message } = response;
        if (code === 0) {
          notification["success"]({
            message: "提示",
            description: "注册成功！",
          });
          // 重定向到登录页（带 redirect 时透传，登录后回到原目标页）
          navigate(redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login");
        } else {
          notification["error"]({
            message: "返回数据错误",
            description: message,
          });
        }
      },
      onError: (error) => {
        // http() 统一抛 HttpError（无 response 字段），安全读取错误信息
        const err = error as { response?: { data?: { message?: string } }; message?: string };
        notification["error"]({
          message: "网络请求错误",
          description: err?.response?.data?.message ?? err?.message ?? "注册失败",
        });
      },
    }
  );
};
