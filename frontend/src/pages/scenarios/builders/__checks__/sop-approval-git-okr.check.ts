// 语图 Round M/N/O/P（排查 SOP / 审批流 / Git log / OKR）可执行断言脚本
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/sop-approval-git-okr.check.ts

import {
  buildSopPrompt,
  parseSop,
  troubleshootingScenario,
} from '../troubleshooting';
import {
  buildApprovalPrompt,
  parseApproval,
  approvalScenario,
} from '../approval';
import {
  buildGitLogPrompt,
  parseGitLog,
  gitLogScenario,
} from '../git-log';
import { buildOkrPrompt, parseOkr, okrScenario } from '../okr';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('parseSop：排查 SOP（Round M）', () => {
  it('五类段标签归段；同义词标签（故障/诊断/处置）等价', () => {
    const result = parseSop(
      '现象：上传失败\n排查：\n查网络\n查配额\n根因：配额满\n解决：扩容\n升级：通知值班',
    );
    assertEqual(result.symptom.join(), '上传失败', '现象段');
    assertEqual(result.steps.join('|'), '查网络|查配额', '排查段两步');
    assertEqual(result.rootCause.join(), '配额满', '根因段');
    assertEqual(result.resolution.join(), '扩容', '解决段');
    assertEqual(result.escalation.join(), '通知值班', '升级段');

    const alias = parseSop('故障：超时\n诊断：查日志');
    assertEqual(alias.symptom.length, 1, '同义词「故障/诊断」同样归段');
  });

  it('无标签行归当前段（首行无标签归 unlabeled）', () => {
    const result = parseSop('查网络\n排查：\n查配额');
    assertEqual(result.unlabeled.length, 1, '首行无标签入 unlabeled');
    assertEqual(result.steps.join(), '查配额', '标签后行归标签段');
  });

  it('指令含决策树/菱形/回流/复测结构；配置契约闭环', () => {
    const prompt = buildSopPrompt(parseSop('现象：超时\n排查：查 A\n查 B\n解决：重启'));
    assertTrue(prompt.includes('菱形'), '判断节点要求');
    assertTrue(prompt.includes('回流'), '复测失败回流');
    assertTrue(prompt.includes('升级路径'), '升级路径兜底');
    assertEqual(troubleshootingScenario.id, 'troubleshooting', 'id');
  });
});

describe('parseApproval：审批流（Round N）', () => {
  it('链/条件/抄送三类行解析', () => {
    const result = parseApproval('链：员工 → 主管 → 人事\n条件：超过 3 天 需 经理复核\n抄送：财务');
    assertEqual(result.chain.join('|'), '员工|主管|人事', '角色链');
    assertEqual(result.conditions.length, 1, '一条条件');
    assertEqual(result.conditions[0].trigger, '超过 3 天', '条件触发词');
    assertEqual(result.conditions[0].action, '经理复核', '条件动作');
    assertEqual(result.cc.join(), '财务', '抄送');
  });

  it('「加签/则/转」动作切分与无标记 → 链补充', () => {
    const result = parseApproval('金额>5000 加签 总监\n主管 → 总经理');
    assertEqual(result.conditions[0].action, '总监', '加签动作切分');
    assertEqual(result.chain.join('|'), '主管|总经理', '无标记含 → 视为链段');
  });

  it('空输入 → 默认三步链降级；指令含泳道/驳回回流', () => {
    const prompt = buildApprovalPrompt(parseApproval(''));
    assertTrue(prompt.includes('默认三步'), '空链降级');
    assertTrue(prompt.includes('泳道'), '泳道结构');
    assertTrue(prompt.includes('驳回'), '驳回回流');
    assertEqual(approvalScenario.id, 'approval', 'id');
  });
});

describe('parseGitLog：提交历史（Round O）', () => {
  const sample =
    'a1b2c3d feat: 新增购物车\ne4f5a6b fix: 修复支付失败\n1a2b3c4 fix: 修复超卖\n' +
    '5d6e7f8 refactor: 抽离请求层\n9a8b7c6 docs: 部署文档\n3f2e1d0 临时兼容旧接口';

  it('hash 行识别、Conventional Commits 分类、中文前缀兜底', () => {
    const result = parseGitLog(sample);
    assertEqual(result.total, 6, '6 条提交');
    const byLabel = Object.fromEntries(result.kindCounts.map((k) => [k.label, k.count]));
    assertEqual(byLabel['新功能'], 1, 'feat×1');
    assertEqual(byLabel['缺陷修复'], 2, 'fix×2');
    assertEqual(byLabel['重构优化'], 1, 'refactor×1');
    assertEqual(byLabel['文档'], 1, 'docs×1');
    assertEqual(byLabel['其他'], 1, '无前缀归其他');
  });

  it('非 log 文本 → total 0 走模板降级；指令含阶段分组与回流线', () => {
    const degraded = buildGitLogPrompt(parseGitLog('今天没有提交'));
    assertTrue(degraded.includes('标准阶段'), '空 log 模板降级');
    const prompt = buildGitLogPrompt(parseGitLog(sample));
    assertTrue(prompt.includes('新功能×1'), '阶段统计进入指令');
    assertTrue(prompt.includes('回流'), '修复-重构回流线');
    assertEqual(gitLogScenario.id, 'git-log', 'id');
  });
});

describe('parseOkr：OKR 拆解（Round P）', () => {
  it('O/KR/动作三层归属（动作归最近的 KR）', () => {
    const result = parseOkr('O：提升转化\nKR1：改版落地页\n  动作A\n  动作B\nKR2：简化注册');
    assertEqual(result.objectives.length, 1, '一个 O');
    assertEqual(result.objectives[0].keyResults.length, 2, '两个 KR');
    assertEqual(result.objectives[0].keyResults[0].actions.join('|'), '动作A|动作B', '动作归 KR1');
    assertEqual(result.objectives[0].keyResults[1].actions.length, 0, 'KR2 无动作');
  });

  it('多 O 归属正确；无 O 的 KR 入 orphans', () => {
    const result = parseOkr('KR0：游离的关键结果\nO：目标一\nKR1：一的关键结果\nO：目标二\nKR1：二的关键结果');
    assertEqual(result.orphans.join(), '游离的关键结果', '无 O 的 KR 孤立');
    assertEqual(result.objectives.length, 2, '两个 O');
    assertEqual(result.objectives[1].keyResults[0].text, '二的关键结果', 'KR 归属最近的 O');
  });

  it('O 后无 KR 前缀的普通行升格为该 O 的 KR（无前缀写法）', () => {
    const result = parseOkr('O：目标\n关键结果甲\n关键结果乙');
    assertEqual(result.objectives[0].keyResults.length, 2, '普通行升格 KR');
  });

  it('空输入 → 模板降级；指令含三层树结构与标注位', () => {
    const degraded = buildOkrPrompt(parseOkr(''));
    assertTrue(degraded.includes('模板'), '空输入模板降级');
    const prompt = buildOkrPrompt(parseOkr('O：增长\nKR1：拉新'));
    assertTrue(prompt.includes('关键结果'), 'KR 层级');
    assertTrue(prompt.includes('置信度'), '标注位');
    assertEqual(okrScenario.id, 'okr', 'id');
  });
});

finish('sop-approval-git-okr');
