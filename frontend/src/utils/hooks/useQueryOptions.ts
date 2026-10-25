/*
 * @Author: yangsen
 * @Date: 2021-11-12 16:10:09
 * @LastEditTime: 2024-12-02 13:31:16
 * @Description: file content
 */
import { notification } from "antd";
import { UseQueryOptions } from "react-query";
export const useNormalQueryOptions = <T = any>(option?: UseQueryOptions<T>) => {
  const options: UseQueryOptions<T> = {
    refetchOnWindowFocus: false,
    onError: (error) => {
      const err = error as { code: number; message: string };
      notification["error"]({
        message: "发生错误",
        description: err.message,
      });
    },
    ...option,
  };
  return options;
};
