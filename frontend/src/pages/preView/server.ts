/*
 * @Author: yangsen
 * @Date: 2022-04-22 16:21:42
 * @LastEditTime: 2024-12-02 14:28:54
 * @Description: 根据id获取要展示的内容
 */

import { useQuery } from "react-query";
import { fromjsonData } from ".";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http } from "../../utils/http";

interface editorDataProp {
  data: { projectId: string; editorData: fromjsonData[] };
}
export const useGetEditorData = (params: { projectId: string }) => {
  return useQuery<editorDataProp>(
    ["useGetEditordata", params],
    () => http(`/editor/getEditorById/${params.projectId}`),
    useNormalQueryOptions({ enabled: params.projectId !== undefined })
  );
};

/**
 * 单项目信息（预览页顶栏展示项目名 / 「继续编辑」回跳使用）。
 * 后端 GET /project/:id 返回原始实体列：project_name / project_desc（snake_case）。
 */
interface ProjectInfoProp {
  data: {
    id: string;
    project_name: string;
    project_desc: string;
    /** 免费档解锁标记（后端并行开发中）：true=已解锁，展示/导出均不带水印；字段未到位时按 undefined 防御式处理 */
    unlocked?: boolean;
  };
}
export const useGetProjectInfo = (projectId: string | undefined) => {
  return useQuery<ProjectInfoProp>(
    ["useGetProjectInfo", projectId],
    () => http(`/project/${projectId}`),
    useNormalQueryOptions({ enabled: projectId !== undefined })
  );
};
