// 语图多形态场景工厂可执行断言脚本（competitor-driven-evolution-batch Round 17）
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/multi-artifact-scenarios.check.ts
// 覆盖：对比表 / 待办清单 / 旅行时间线 / 读书导图 四个 builder 的解析与指令构造,
//       以及 registry 注册闭环（id 可寻址 + formHint 与形态配对）。

import {
  parseComparison,
  buildComparisonPrompt,
  comparisonScenario,
} from '../comparison';
import {
  parseChecklistInput,
  buildChecklistPrompt,
  todoChecklistScenario,
} from '../todo-checklist';
import {
  parseTravelPlan,
  buildTravelPlanPrompt,
  travelPlanScenario,
} from '../travel-plan';
import {
  parseReadingMap,
  buildReadingMapPrompt,
  readingMapScenario,
} from '../reading-map';
import { findScenario } from '../../registry';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('方案对比表 builder（Round 17）', () => {
  it('对象拆分：vs / 顿号 / 逗号均可;其余行作为维度与补充', () => {
    const vs = parseComparison('自建 vs 采购\n成本\n工期');
    assertEqual(vs.subjects.join('|'), '自建|采购', 'vs 拆分');
    assertEqual(vs.extraLines.length, 2, '其余行保留');
    const cn = parseComparison('阿里云、腾讯云、华为云');
    assertEqual(cn.subjects.length, 3, '顿号拆分三个对象');
  });

  it('指令：对象进引号、短行作点名维度、含推荐结论;formHint=table', () => {
    const prompt = buildComparisonPrompt(parseComparison('自建 vs 采购\n成本\n工期'));
    assertTrue(prompt.includes('「自建」') && prompt.includes('「采购」'), '对象入指令');
    assertTrue(prompt.includes('成本、工期'), '点名维度');
    assertTrue(prompt.includes('推荐结论'), '结论要求');
    assertEqual(comparisonScenario.formHint, 'table', 'formHint 配对');
    assertEqual(comparisonScenario.id, 'comparison', 'id');
  });

  it('对象不足两个：降级为自由描述但保留表格形态要求', () => {
    // 注意:逗号是对象分隔符,降级用例用不含分隔符的单对象描述
    const prompt = buildComparisonPrompt(parseComparison('团队只有三个后端还要两个月上线'));
    assertTrue(prompt.includes('方案对比表'), '降级仍要求表格');
  });

  it('空输入防御:不抛错,指令仍可执行', () => {
    const prompt = buildComparisonPrompt(parseComparison(''));
    assertTrue(prompt.length > 10, '空输入给通用指令');
  });
});

describe('待办清单 builder（Round 17）', () => {
  it('分组行（中文/英文冒号）开组,散项归「待办」默认组并清理空组', () => {
    const result = parseChecklistInput('上线前：\n回归测试\n数据库备份\n上线后：\n监控观察');
    assertEqual(result.groups.length, 2, '两个分组');
    assertEqual(result.groups[0].title, '上线前', '组名保留');
    assertEqual(result.groups[0].items.length, 2, '组内项数');
    assertEqual(result.totalItems, 3, '总项数');
    const loose = parseChecklistInput('买牛奶\n交房租');
    assertEqual(loose.groups.length, 1, '仅默认组');
    assertEqual(loose.groups[0].title, '待办', '默认组名');
  });

  it('指令保留用户分组语义;formHint=checklist', () => {
    const prompt = buildChecklistPrompt(parseChecklistInput('上线前：\n回归测试\n上线后：\n监控观察'));
    assertTrue(prompt.includes('上线前：回归测试'), '分组进入指令');
    assertTrue(prompt.includes('可勾选'), '可勾选要求');
    assertEqual(todoChecklistScenario.formHint, 'checklist', 'formHint 配对');
    assertEqual(todoChecklistScenario.id, 'checklist', 'id');
  });

  it('空输入防御:给通用分组兜底指令', () => {
    const prompt = buildChecklistPrompt(parseChecklistInput(''));
    assertTrue(prompt.includes('准备'), '通用分组兜底');
  });
});

describe('旅行计划时间线 builder（Round 17）', () => {
  it('Day/D/第N天/中文数字开组 + 同日归并 + 默认组清理', () => {
    const result = parseTravelPlan('Day1: 上午 武侯祠\nD1: 晚上 火锅\n第二天: 熊猫基地');
    assertEqual(result.days.length, 2, 'Day1 与 D1 归并;第二天独立');
    assertEqual(result.days[0].label, 'Day1', '标签归一');
    assertEqual(result.days[0].items.join('|'), '上午 武侯祠|晚上 火锅', '同日归并');
    assertEqual(result.days[1].label, 'Day2', '中文数字转换');
  });

  it('指令保留时间点原样并强调按时间先后;formHint=timeline', () => {
    const prompt = buildTravelPlanPrompt(parseTravelPlan('Day1: 09:00 出发\nDay1: 12:00 午餐'));
    assertTrue(prompt.includes('09:00') && prompt.includes('12:00'), '时间点保留');
    assertTrue(prompt.includes('时间先后'), '排序要求');
    assertEqual(travelPlanScenario.formHint, 'timeline', 'formHint 配对');
    assertEqual(travelPlanScenario.id, 'travel-plan', 'id');
  });

  it('空输入防御:给三天两晚通用指令', () => {
    const prompt = buildTravelPlanPrompt(parseTravelPlan(''));
    assertTrue(prompt.includes('三天两晚'), '通用行程兜底');
  });
});

describe('读书笔记导图 builder（Round 17）', () => {
  it('书名号提取优先;其余行作分支线索', () => {
    const result = parseReadingMap('《红楼梦》\n四大家族关系\n主要人物');
    assertEqual(result.book, '红楼梦', '书名号提取');
    assertEqual(result.points.length, 2, '分支线索保留');
    const firstLine = parseReadingMap('原则\n生活原则\n工作原则');
    assertEqual(firstLine.book, '原则', '首行书名兜底');
    assertEqual(firstLine.points.length, 2, '首行之后为要点');
  });

  it('指令含书名与层级发散要求;formHint=mindmap', () => {
    const prompt = buildReadingMapPrompt(parseReadingMap('《红楼梦》\n主要人物'));
    assertTrue(prompt.includes('《红楼梦》'), '书名入指令');
    assertTrue(prompt.includes('思维导图'), '形态要求');
    assertTrue(prompt.includes('层级'), '层级要求');
    assertEqual(readingMapScenario.formHint, 'mindmap', 'formHint 配对');
    assertEqual(readingMapScenario.id, 'reading-map', 'id');
  });

  it('空输入防御:不抛错,给通用四分支指令', () => {
    const prompt = buildReadingMapPrompt(parseReadingMap(''));
    assertTrue(prompt.includes('背景脉络'), '通用分支兜底');
  });
});

describe('场景注册闭环（Round 17）', () => {
  it('四个新场景可经 findScenario 寻址,formHint 与形态一一配对', () => {
    assertEqual(findScenario('comparison')?.formHint, 'table', 'comparison → table');
    assertEqual(findScenario('checklist')?.formHint, 'checklist', 'checklist → checklist');
    assertEqual(findScenario('travel-plan')?.formHint, 'timeline', 'travel-plan → timeline');
    assertEqual(findScenario('reading-map')?.formHint, 'mindmap', 'reading-map → mindmap');
  });

  it('既有流程图场景不带 formHint（保持旧链路）', () => {
    assertEqual(findScenario('travel')?.formHint, undefined, 'travel 无 formHint');
    assertEqual(findScenario('weekly-report')?.formHint, undefined, 'weekly-report 无 formHint');
  });

  it('未注册 id 返回 undefined（路由 404 卡兜底）', () => {
    assertEqual(findScenario('not-exist'), undefined, '未命中');
    assertEqual(findScenario(undefined), undefined, '空参数');
  });
});

finish('multi-artifact-scenarios');
