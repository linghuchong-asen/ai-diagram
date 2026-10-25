/*
 * @Author: yangsen
 * @Date: 2022-04-19 10:20:08
 * @LastEditTime: 2024-12-14 16:54:52
 * @Description: 项目管理模块，后端api
 */

import { FormInstance, notification } from "antd";
import axios from "axios";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { tableDataProp } from ".";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http, onErrorTips } from "../../utils/http";

export interface GetProjectQueryData {
  data: {
    page: { pageSize: number; total: number };
    tableData: tableDataProp[];
  };
}

/**
 * 数据量单条数据查询--可以用作基本请求模板
 *
 * 用法：const {isLoading,isSuccess,isError,data} = useGetProject(),具体见react-query官网
 */

// TODO:使用react-query有什么好处
export const useGetProject = (params: {
  pageSize: number;
  pageNumber: number;
}) => {
  return useQuery<GetProjectQueryData>(
    ["useGetProject", params],
    () => http("/project", { params }),
    useNormalQueryOptions()
  );
};

/** 全文检索结果条目：GET /projectSearch/search 返回的 list 项 */
export interface ProjectSearchItem {
  projectId: string;
  projectName: string;
  projectDesc: string;
  contentSnippet: string;
  updateTime: string;
  rank: number;
}

export interface SearchProjectsQueryData {
  data: {
    list: ProjectSearchItem[];
    total: number;
    query: string;
  };
}

/** 主动取消检索请求时写入错误消息的前缀，onError 据此忽略被取消的请求 */
const SEARCH_CANCELLED_FLAG = "[search-cancelled]";

type SearchCancelSource = ReturnType<typeof axios.CancelToken.source>;

// 最近一次在途检索请求的取消源（该 hook 仅 home 页一处使用），用于关键词变更/组件卸载时中止旧请求
let searchAbortSource: SearchCancelSource | null = null;

/**
 * 项目全文检索（同时支持项目名称与项目内容），q 为空时由 enabled 保证不发起请求。
 * 失败仅通过 onError 提示，不影响默认项目列表展示。
 */
export const useSearchProjects = (keyword: string) => {
  const baseOptions = useNormalQueryOptions<SearchProjectsQueryData>();
  const query = useQuery<SearchProjectsQueryData>(
    ["useSearchProjects", keyword],
    async () => {
      // 新检索发起前，中止上一次仍在途的请求（关键词连续变更场景）
      if (searchAbortSource) {
        searchAbortSource.cancel(`${SEARCH_CANCELLED_FLAG} superseded`);
      }
      const source = axios.CancelToken.source();
      searchAbortSource = source;
      try {
        return await http<SearchProjectsQueryData["data"]>("/projectSearch/search", {
          params: { q: keyword, limit: 20 },
          cancelToken: source.token,
        });
      } finally {
        if (searchAbortSource === source) {
          searchAbortSource = null;
        }
      }
    },
    {
      ...baseOptions,
      enabled: keyword.trim().length > 0,
      retry: false,
      onError: (error) => {
        const message = (error as { message?: string })?.message;
        if (typeof message === "string" && message.startsWith(SEARCH_CANCELLED_FLAG)) {
          return;
        }
        baseOptions.onError?.(error);
      },
    }
  );

  // 组件卸载时中止仍在途的检索请求
  useEffect(() => {
    return () => {
      if (searchAbortSource) {
        searchAbortSource.cancel(`${SEARCH_CANCELLED_FLAG} unmount`);
        searchAbortSource = null;
      }
    };
  }, []);

  return query;
};

/** 导出json文件功能 */
export const useGetDownload = () => {
  return useMutation(
    (projectId: string) =>
      http<Blob>("/project/editDataFile", {
        method: "get",
        params: { projectId },
        responseType: "blob",
      }),
    {
      onError: onErrorTips,
    }
  );
};

export const useAddProject = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (params: { projectName: string; projectDesc: string }) =>
      http<[]>(`/project`, {
        method: "post",
        params,
      }),
    {
      onSuccess: (response) => {
        const { data, message } = response;
        if (data.length === 0) {
          notification["error"]({
            message: "error",
            description: message,
          });
        } else {
          notification["success"]({
            message: "提示",
            description: "添加成功！",
          });
        }

        // 刷新需要更新的query
        queryClient.invalidateQueries("useGetProject");
        // queryClient.invalidateQueries("useLLJobData");
      },
      onError: onErrorTips,
    }
  );
};

export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (params: { projectIds: string[] }) =>
      http(`/project/delProject`, {
        method: "delete",
        params,
      }),
    {
      onSuccess: (response) => {
        const { data, message } = response;
        notification["success"]({
          message: "提示",
          description: message,
        });
        queryClient.invalidateQueries("useGetProject");
      },
      onError: onErrorTips,
    }
  );
};
// 导入接口(本地JSON)
export const useImportProject = (
  setLocalVisible: (param: boolean) => void,
  setFileList: (param: []) => void,
  form: FormInstance
) => {
  return useMutation(
    (params: any) =>
      http<[]>(`/editdata/importEditdata`, {
        method: "post",
        params,
      }),
    {
      onSuccess: (response) => {
        const { data, message } = response;
        if (Object.keys(data).length === 0) {
          notification["success"]({
            message: "error",
            description: message,
          });
        } else {
          // 隐藏对话框
          setLocalVisible(false);
          // 清空upload组件的fileList
          setFileList([]);
          // 清空form内容
          form.setFieldsValue({ localJson: { file: null, fileList: null } });
          notification["success"]({
            message: "提示",
            description: "导入成功！",
          });
        }
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
