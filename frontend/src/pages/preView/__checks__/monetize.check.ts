/*
 * @Description: 商业化闭环批次 check 脚本 —— monetize.ts 纯函数断言
 * 运行：cd frontend && npx tsx src/pages/preView/__checks__/monetize.check.ts
 * 覆盖：价格格式化、会员到期文案、支付回跳参数解析（订单类型容错）、
 *       看板窗口 GMV 汇总 —— 这些是付费转化最后一公里的展示/跳转口径，
 *       算错一分钱或跳错一个页面都是直接的收入损失。
 */
import { describe, it, finish } from "../../ai/__checks__/check-util";
import {
  buildInviteLink,
  buildTrendView,
  describeOrderKind,
  fenToYuan,
  formatVipExpire,
  parseUnlockResultQuery,
  sanitizeInviteCode,
  vipDaysLeft,
  vipRenewalText,
  windowGmvYuan,
  type DailyTrendPoint,
} from "../monetize";

describe("fenToYuan（分 → 展示价格）", () => {
  it("190 分 → ¥1.9（解锁常规价）", () => {
    if (fenToYuan(190) !== "¥1.9") throw new Error(fenToYuan(190));
  });
  it("90 分 → ¥0.9（首单价）；590 分 → ¥5.9（会员首月）", () => {
    if (fenToYuan(90) !== "¥0.9") throw new Error(fenToYuan(90));
    if (fenToYuan(590) !== "¥5.9") throw new Error(fenToYuan(590));
  });
  it("990 分 → ¥9.9（会员月卡）", () => {
    if (fenToYuan(990) !== "¥9.9") throw new Error(fenToYuan(990));
  });
  it("非法输入（负数/NaN）兜底 ¥0.0，不展示负价", () => {
    if (fenToYuan(-5) !== "¥0.0") throw new Error(fenToYuan(-5));
    if (fenToYuan(Number.NaN) !== "¥0.0") throw new Error(fenToYuan(Number.NaN));
  });
});

describe("formatVipExpire（会员到期文案）", () => {
  it("ISO 时间 → 「YYYY-MM-DD 到期」", () => {
    const out = formatVipExpire(new Date("2026-11-25T15:00:00.000Z").toISOString());
    if (!/^\d{4}-\d{2}-\d{2} 到期$/.test(out)) throw new Error(out);
  });
  it("空值/非法时间 → 空串（调用方按需隐藏标签）", () => {
    if (formatVipExpire(null) !== "") throw new Error("null 应为空串");
    if (formatVipExpire(undefined) !== "") throw new Error("undefined 应为空串");
    if (formatVipExpire("not-a-date") !== "") throw new Error("非法时间应为空串");
  });
});

describe("parseUnlockResultQuery（支付回跳参数解析）", () => {
  it("完整参数：unlock 单带 orderId/projectId", () => {
    const q = parseUnlockResultQuery(
      "?orderId=abc-123&kind=unlock&projectId=42"
    );
    if (q.orderId !== "abc-123" || q.kind !== "unlock" || q.projectId !== "42") {
      throw new Error(JSON.stringify(q));
    }
  });
  it("vip 单识别为会员回跳", () => {
    const q = parseUnlockResultQuery("?orderId=v1&kind=vip");
    if (q.kind !== "vip") throw new Error(q.kind);
  });
  it("kind 缺失/非法 → 回落 unlock（老链接兼容）", () => {
    if (parseUnlockResultQuery("?orderId=x").kind !== "unlock") {
      throw new Error("缺 kind 应回落 unlock");
    }
    if (parseUnlockResultQuery("?orderId=x&kind=weird").kind !== "unlock") {
      throw new Error("非法 kind 应回落 unlock");
    }
  });
  it("空串/缺字段 → 空串（页面渲染无效态，不白屏）", () => {
    const q = parseUnlockResultQuery("");
    if (q.orderId !== "" || q.projectId !== "") throw new Error(JSON.stringify(q));
  });
});

describe("describeOrderKind / windowGmvYuan（看板口径）", () => {
  it("订单类型文案：unlock → 单图解锁；vip → 会员月卡", () => {
    if (describeOrderKind("unlock") !== "单图解锁") throw new Error("unlock 文案");
    if (describeOrderKind("vip") !== "会员月卡") throw new Error("vip 文案");
  });
  it("窗口 GMV = 解锁 + 会员（分转元两位小数）", () => {
    const yuan = windowGmvYuan({
      unlockOrders: 2,
      unlockGmvFen: 380,
      vipOrders: 1,
      vipGmvFen: 990,
    });
    if (yuan !== "13.70") throw new Error(yuan);
  });
  it("窗口缺失（undefined）→ 0.00", () => {
    if (windowGmvYuan(undefined) !== "0.00") throw new Error("undefined 应回 0.00");
  });
});

describe("buildTrendView（看板日趋势柱状图视图，付费转化增强批次）", () => {
  const points: DailyTrendPoint[] = [
    { day: "2026-10-25", unlockGmvFen: 0, vipGmvFen: 0 },
    { day: "2026-10-26", unlockGmvFen: 380, vipGmvFen: 0 },
    { day: "2026-10-27", unlockGmvFen: 190, vipGmvFen: 990 },
  ];

  it("按窗口最大单日总额归一化（最大日 = 100%）", () => {
    const bars = buildTrendView(points);
    if (bars.length !== 3) throw new Error(`长度 ${bars.length}`);
    const maxDay = bars[2];
    if (Math.round(maxDay.unlockPct + maxDay.vipPct) !== 100) {
      throw new Error(`最大日合计 ${maxDay.unlockPct + maxDay.vipPct}%`);
    }
    // 380 / 1180 ≈ 32.2%
    if (bars[1].unlockPct < 32 || bars[1].unlockPct > 33) {
      throw new Error(`10-26 解锁高度 ${bars[1].unlockPct}%`);
    }
  });

  it("无收入日高度 0 + 弱化标签；有收入日给最小可见高度", () => {
    const bars = buildTrendView(points);
    if (bars[0].hasRevenue) throw new Error("10-25 无收入却标有收入");
    if (bars[0].unlockPct !== 0 || bars[0].vipPct !== 0) throw new Error("无收入日高度应为 0");
    if (bars[1].unlockPct < 2) throw new Error("有收入日应 ≥2% 可见");
  });

  it("标签为 MM-DD 短格式；金额为元两位小数", () => {
    const bars = buildTrendView(points);
    if (bars[0].label !== "10-25") throw new Error(bars[0].label);
    if (bars[2].totalYuan !== "11.80") throw new Error(bars[2].totalYuan);
  });

  it("undefined/空数组 → 空视图（看板无数据不崩）", () => {
    if (buildTrendView(undefined).length !== 0) throw new Error("undefined 应回空数组");
    if (buildTrendView([]).length !== 0) throw new Error("空数组应回空数组");
    const single = buildTrendView([{ day: "2026-10-27", unlockGmvFen: 100, vipGmvFen: 0 }]);
    if (Math.round(single[0].unlockPct) !== 100) throw new Error("单点应为 100%");
  });
});

describe("sanitizeInviteCode / buildInviteLink（邀请裂变批次）", () => {
  it("邀请码白名单：4-16 位字母数字通过，其余为 null", () => {
    if (sanitizeInviteCode("ABCD2345") !== "ABCD2345") throw new Error("合法码应通过");
    if (sanitizeInviteCode("ab12") !== "ab12") throw new Error("4 位小写应通过");
    if (sanitizeInviteCode("AB1") !== null) throw new Error("过短应为 null");
    if (sanitizeInviteCode("BAD!!码") !== null) throw new Error("非法字符应为 null");
    if (sanitizeInviteCode(123) !== null) throw new Error("非字符串应为 null");
    if (sanitizeInviteCode(undefined) !== null) throw new Error("undefined 应为 null");
  });

  it("清洗前后空格", () => {
    if (sanitizeInviteCode("  ABCD2345 ") !== "ABCD2345") throw new Error("应 trim");
  });

  it("buildInviteLink：origin 去尾斜杠 + ic 参数", () => {
    const link = buildInviteLink("https://yutu.app/", "ABCD2345");
    if (link !== "https://yutu.app/register?ic=ABCD2345") throw new Error(link);
  });

  it("buildInviteLink：非法码/空码 → 空串（不生成坏链接）", () => {
    if (buildInviteLink("https://yutu.app", "!!") !== "") throw new Error("非法码应空串");
    if (buildInviteLink("https://yutu.app", "") !== "") throw new Error("空码应空串");
  });
});

describe("vipDaysLeft / vipRenewalText（会员到期提醒，vip-renewal-reminder-batch）", () => {
  const NOW = new Date("2026-10-27T12:00:00");

  it("剩余天数 ceil ≥1：剩 30 小时 → 2 天", () => {
    const left = vipDaysLeft(new Date("2026-10-28T18:00:00").toISOString(), NOW);
    if (left !== 2) throw new Error(`应 ceil 为 2 天，实际 ${left}`);
  });

  it("空/非法/已过期 → null（非会员不渲染提醒）", () => {
    if (vipDaysLeft(null, NOW) !== null) throw new Error("null 应为 null");
    if (vipDaysLeft("bad-date", NOW) !== null) throw new Error("非法时间应为 null");
    if (vipDaysLeft(new Date("2026-10-27T11:59:59").toISOString(), NOW) !== null) {
      throw new Error("已过期应为 null");
    }
  });

  it("提醒窗口：≤3 天为到期警示文案，>3 天为常态剩余天数", () => {
    if (vipRenewalText(1) !== "1 天后到期 · 续费") throw new Error(vipRenewalText(1) ?? "");
    if (vipRenewalText(3) !== "3 天后到期 · 续费") throw new Error("3 天应在提醒窗口内");
    if (vipRenewalText(4) !== "会员剩 4 天") throw new Error("4 天应为常态文案");
    if (vipRenewalText(null) !== null) throw new Error("非会员应 null");
  });
});

finish("monetize.check");
