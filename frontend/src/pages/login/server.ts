import { useMutation } from "react-query";
import { http } from "../../utils/http";
import { notification } from "antd";
import { useNavigate } from "react-router-dom";

interface ILoginParams {
  username: string;
  password: string;
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
          // 重定向到首页
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

export const useRegister = () => {
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
          // 重定向到登录页
          navigate("/login");
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
