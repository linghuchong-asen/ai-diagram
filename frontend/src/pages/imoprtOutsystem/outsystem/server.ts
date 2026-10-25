/*
 * @Description:
 * @Version: 2.0
 * @Author: yangsen
 * @Date: 2022-04-28 16:17:22
 * @LastEditors: yangsen
 * @LastEditTime: 2022-05-01 09:04:07
 */
import { notification } from "antd";
import { useMutation } from "react-query";
import { http } from "../../../utils/http";

// todo:这里的导入指的是什么啊，还是通过MySQL
export const useImport = () => {
  return useMutation(
    (params: any) =>
      http<[]>(`/importmysql`, {
        method: "post",
        params,
      }),
    {
      onSuccess: () => {
        notification["success"]({
          message: "提示",
          description: "导入成功！",
        });
      },
      onError: (error) => {
        // http() 统一抛 HttpError（无 response 字段），安全读取错误信息
        const err = error as { response?: { data?: { message?: string } }; message?: string };
        notification["error"]({
          message: "发生错误",
          description: err?.response?.data?.message ?? err?.message ?? "导入失败",
        });
      },
    }
  );
};
