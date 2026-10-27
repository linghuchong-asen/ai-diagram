/*
 * @Description: 代码年报接口（Round B · annual-report-batch）
 *   GET /annual/report?source=github|gitee&user=<username>&year=<YYYY>
 * 公开端点（免登录 + 限流）；后端确定性聚合公开仓库统计，零 LLM 成本。
 */

import { useQuery } from "react-query";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http } from "../../utils/http";

/** 数据源（与后端 AnnualSource 一致） */
export type AnnualSource = "github" | "gitee";

/** 年报统计结果（后端契约） */
export interface AnnualReport {
  source: AnnualSource;
  username: string;
  year: number;
  repoCount: number;
  /** 单页 100 仓库截断标记（口径诚实：为 true 时总数显示 N+） */
  repoCountTruncated: boolean;
  reposCreatedInYear: number;
  reposActiveInYear: number;
  starsTotal: number;
  starsOfNewRepos: number;
  /** 语言分布 Top5（[语言, 仓库数] 降序） */
  topLanguages: Array<[string, number]>;
  topRepo: { name: string; stars: number } | null;
  lastPushedRepo: string | null;
}

interface AnnualReportProp {
  data: AnnualReport;
}

/** 拉取年报：仅提交后发起（enabled 由页面控制），失败不重试（统一错误态） */
export const useGetAnnualReport = (params: {
  source: AnnualSource;
  user: string;
  year: number;
  enabled: boolean;
}) => {
  return useQuery<AnnualReportProp>(
    ["useGetAnnualReport", params.source, params.user, params.year],
    () =>
      http<AnnualReport>(
        `/annual/report?source=${encodeURIComponent(params.source)}&user=${encodeURIComponent(
          params.user,
        )}&year=${params.year}`
      ),
    useNormalQueryOptions({ enabled: params.enabled && !!params.user, retry: false })
  );
};
