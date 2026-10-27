/*
 * @Description: 营收看板（商业化闭环批次）—— 路由 /admin/revenue（仅 role=root）
 * 让盈利「看得见」的运营内页：今日/近 7 天/近 30 天三窗口的解锁与会员 GMV、
 * 订单笔数、累计付费用户、在期会员数、最近 20 笔订单明细。
 * 鉴权双层：前端 PrivateRoute（登录态）+ 页内 role 校验（非 root 渲染 403 态），
 * 后端 GET /billing/admin/overview 再校验一次 root（防止绕过前端直调）。
 */

import { Button, Card, Col, Row, Spin, Statistic, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "react-query";
import { http } from "../../../utils/http";
import { BrandLogoSmall } from "../../legal/brand";
import {
  buildTrendView,
  describeOrderKind,
  fenToYuan,
  windowGmvYuan,
  type OrderKind,
} from "../../preView/monetize";

/** 营收看板响应（与后端 AdminRevenueOverview 契约对齐） */
interface RevenueWindowView {
  unlockOrders: number;
  unlockGmvFen: number;
  vipOrders: number;
  vipGmvFen: number;
}
interface AdminRevenueOverviewView {
  windows: { today: RevenueWindowView; last7d: RevenueWindowView; last30d: RevenueWindowView };
  vipActiveUsers: number;
  paidUsers: number;
  /** 邀请裂变批次：累计邀请注册数（后端防御式读取，旧版本无此字段时按 0 展示） */
  invitedUsers?: number;
  dailyTrend: Array<{ day: string; unlockGmvFen: number; vipGmvFen: number }>;
  recentOrders: Array<{
    orderId: string;
    kind: OrderKind;
    userId: string;
    amount: number;
    status: string;
    channel: string;
    updateTime: string | null;
  }>;
}

/** 窗口卡片定义（标题 + 后端字段键） */
const WINDOWS: Array<{ key: "today" | "last7d" | "last30d"; title: string }> = [
  { key: "today", title: "今日" },
  { key: "last7d", title: "近 7 天" },
  { key: "last30d", title: "近 30 天" },
];

/** 社区模板待审条目（community-template-batch，与后端 CommunityTemplateEntity 对齐） */
interface PendingCommunityTemplate {
  id: string;
  projectId: string;
  ownerName: string;
  title: string;
  description: string;
  status: string;
}

export const AdminRevenuePage = () => {
  /** 当前登录用户（页内 root 校验） */
  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);

  useEffect(() => {
    http<{ role?: string }>("/user")
      .then((response) => {
        setRole(response.data?.role ?? null);
      })
      .catch(() => setRole(null))
      .finally(() => setRoleLoaded(true));
  }, []);

  const { data, isLoading, isError } = useQuery(
    ["adminRevenueOverview"],
    () => http<AdminRevenueOverviewView>("/billing/admin/overview"),
    { enabled: role === "root", retry: false }
  );

  const overview = data?.data;
  /** 订单表数据源（antd Table 需稳定 key） */
  const orders = useMemo(() => overview?.recentOrders ?? [], [overview]);
  /** 日趋势柱状图视图模型（纯函数归一化，供纯 CSS 柱状图消费） */
  const trendBars = useMemo(() => buildTrendView(overview?.dailyTrend), [overview]);

  /* ===== 社区模板审核（community-template-batch）：root 在营收页一并处理内容审核 ===== */

  const [pendingTpl, setPendingTpl] = useState<PendingCommunityTemplate[] | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const fetchPending = () => {
    http<PendingCommunityTemplate[]>("/template/community/pending")
      .then((response) => setPendingTpl(response.data ?? []))
      .catch(() => setPendingTpl(null));
  };

  useEffect(() => {
    if (role === "root") fetchPending();
  }, [role]);

  /** 审核：approve=true 上架 / false 驳回；完成后刷新待审列表 */
  const handleReview = async (id: string, approve: boolean) => {
    if (reviewingId) return;
    setReviewingId(id);
    try {
      await http(`/template/community/review/${id}`, {
        method: "post",
        params: { approve },
      });
      setPendingTpl((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    } catch {
      // 失败由 http 层统一提示；列表不刷新可重试
    } finally {
      setReviewingId(null);
    }
  };

  if (roleLoaded && role !== "root") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0c0e" }}>
        <Card style={{ width: 360, textAlign: "center" }}>
          <Typography.Text type="secondary">
            营收看板仅对运营负责人（root）开放，当前账号无权访问。
          </Typography.Text>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0b0c0e", padding: "24px 20px 48px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <BrandLogoSmall />
          <span className="yt-mono yt-preview-tag">REVENUE</span>
        </div>
        <Typography.Title level={4} style={{ color: "var(--yt-text-primary)", marginTop: 8 }}>
          营收看板
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          口径：GMV 按「支付完成时间」（订单 update_time）统计；金额 = 解锁单 + 会员单；
          付费用户 = 任一类型存在已支付订单的去重账号。
        </Typography.Paragraph>

        {isLoading && (
          <div style={{ display: "grid", placeItems: "center", padding: 60 }}>
            <Spin tip="正在汇总营收…" />
          </div>
        )}
        {isError && (
          <Card>
            <Typography.Text type="danger">营收数据拉取失败，请稍后重试。</Typography.Text>
          </Card>
        )}

        {overview && (
          <>
            <Row gutter={[12, 12]}>
              {WINDOWS.map(({ key, title }) => {
                const win = overview.windows[key];
                return (
                  <Col xs={24} md={8} key={key}>
                    <Card size="small">
                      <Statistic
                        title={`${title} GMV`}
                        value={windowGmvYuan(win)}
                        precision={2}
                        prefix="¥"
                      />
                      <div style={{ fontSize: 12, color: "var(--yt-text-secondary)", marginTop: 6 }}>
                        解锁 {win.unlockOrders} 笔 / {fenToYuan(win.unlockGmvFen)} · 会员{" "}
                        {win.vipOrders} 笔 / {fenToYuan(win.vipGmvFen)}
                      </div>
                    </Card>
                  </Col>
                );
              })}
              <Col xs={12} md={8}>
                <Card size="small">
                  <Statistic title="累计付费用户" value={overview.paidUsers} suffix="人" />
                </Card>
              </Col>
              <Col xs={12} md={8}>
                <Card size="small">
                  <Statistic title="在期会员" value={overview.vipActiveUsers} suffix="人" />
                </Card>
              </Col>
              <Col xs={12} md={8}>
                <Card size="small">
                  <Statistic title="累计邀请注册" value={overview.invitedUsers ?? 0} suffix="人" />
                </Card>
              </Col>
            </Row>

            {/* 近 14 天日趋势（纯 CSS 堆叠柱状图：上解锁/下会员，零图表依赖） */}
            <Card size="small" style={{ marginTop: 16 }} title="近 14 天营收趋势">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
                {trendBars.map((bar) => (
                  <div
                    key={bar.day}
                    style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
                    title={`${bar.day}：合计 ${bar.totalYuan} 元（解锁 + 会员）`}
                  >
                    {bar.hasRevenue ? (
                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                        <div
                          style={{
                            height: `${bar.unlockPct}%`,
                            background: "var(--yt-accent)",
                            borderRadius: "2px 2px 0 0",
                            minHeight: bar.unlockPct > 0 ? 2 : 0,
                          }}
                        />
                        <div
                          style={{
                            height: `${bar.vipPct}%`,
                            background: "rgba(168, 85, 247, 0.75)",
                            minHeight: bar.vipPct > 0 ? 2 : 0,
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1 }} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                {trendBars.map((bar) => (
                  <div
                    key={bar.day}
                    className="yt-mono"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontSize: 9,
                      color: bar.hasRevenue ? "var(--yt-accent)" : "var(--yt-text-muted)",
                    }}
                  >
                    {bar.label}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--yt-text-muted)" }}>
                图例：<span style={{ color: "var(--yt-accent)" }}>■</span> 单图解锁 ·
                <span style={{ color: "rgba(168,85,247,0.9)", marginLeft: 6 }}>■</span> 会员月卡；悬停柱体看当日金额。
              </div>
            </Card>

            {/* 社区模板审核（community-template-batch）：UGC 必审后上架的合规闸门 */}
            {pendingTpl !== null && (
              <Card
                size="small"
                style={{ marginTop: 16 }}
                title={`社区模板待审（${pendingTpl.length}）`}
              >
                {pendingTpl.length === 0 ? (
                  <Typography.Text type="secondary">暂无待审投稿。</Typography.Text>
                ) : (
                  pendingTpl.map((tpl) => (
                    <div
                      key={tpl.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--yt-text-primary)" }}>
                          {tpl.title}
                          <span style={{ fontSize: 11, color: "var(--yt-text-muted)", marginLeft: 8 }}>
                            By {tpl.ownerName}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--yt-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tpl.description || "（无场景说明）"}
                        </div>
                      </div>
                      <Button
                        size="small"
                        type="primary"
                        className="yt-btn-primary"
                        loading={reviewingId === tpl.id}
                        onClick={() => handleReview(tpl.id, true)}
                      >
                        通过
                      </Button>
                      <Button
                        size="small"
                        danger
                        loading={reviewingId === tpl.id}
                        onClick={() => handleReview(tpl.id, false)}
                      >
                        拒绝
                      </Button>
                    </div>
                  ))
                )}
              </Card>
            )}

            <Card size="small" style={{ marginTop: 16 }} title="最近订单（≤20 笔）">
              <Table
                size="small"
                rowKey="orderId"
                dataSource={orders}
                pagination={false}
                columns={[
                  {
                    title: "时间",
                    dataIndex: "updateTime",
                    width: 170,
                    render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—"),
                  },
                  {
                    title: "类型",
                    dataIndex: "kind",
                    width: 90,
                    render: (v: OrderKind) => describeOrderKind(v),
                  },
                  {
                    title: "金额",
                    dataIndex: "amount",
                    width: 90,
                    render: (v: number) => fenToYuan(v),
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 90,
                    render: (v: string) =>
                      v === "paid" ? <Tag color="success">已支付</Tag> : <Tag>待支付</Tag>,
                  },
                  { title: "通道", dataIndex: "channel", width: 100 },
                  {
                    title: "订单号",
                    dataIndex: "orderId",
                    render: (v: string) => (
                      <span className="yt-mono" style={{ fontSize: 11 }}>
                        {v.slice(0, 8)}…
                      </span>
                    ),
                  },
                  {
                    title: "用户",
                    dataIndex: "userId",
                    render: (v: string) => (
                      <span className="yt-mono" style={{ fontSize: 11 }}>
                        {v.slice(0, 8)}…
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
