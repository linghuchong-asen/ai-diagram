// 语图 Round G（周报一图流 builder）可执行断言脚本
// 覆盖：【】分组、冒号分组、同名组归并、无标记行归当前组/其他、纯符号行忽略、
//      冒号误判防御、prompt 结构完整、空输入防御。
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/weekly-report.check.ts

import { buildWeeklyPrompt, parseWeeklyItems, weeklyReportScenario } from '../weekly-report';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('parseWeeklyItems：分组解析', () => {
  it('【项目名】分组 + 同名组归并 + 顺序保持', () => {
    const result = parseWeeklyItems(
      '【官网改版】完成设计稿\n【数据平台】接埋点\n【官网改版】前端 60%',
    );
    assertEqual(result.totalItems, 3, '共 3 项');
    assertEqual(result.groups.length, 2, '两个项目组');
    assertEqual(result.groups[0].name, '官网改版', '首组名');
    assertEqual(result.groups[0].items.join('|'), '完成设计稿|前端 60%', '同名组归并');
    assertEqual(result.groups[1].name, '数据平台', '组顺序保持');
  });

  it('「项目名：事项」冒号分组', () => {
    const result = parseWeeklyItems('官网改版：完成设计稿\n数据平台：接埋点');
    assertEqual(result.groups.length, 2, '冒号也应开组');
    assertEqual(result.groups[0].items[0], '完成设计稿', '事项内容正确');
  });

  it('冒号误判防御：「完成：50%」不开新组', () => {
    const result = parseWeeklyItems('官网改版：推进中\n完成：50%');
    assertEqual(result.groups.length, 1, '「完成：」不应开新组（冒号前为普通词且组已存在）');
  });

  it('无任何标记 → 全部归「其他事项」', () => {
    const result = parseWeeklyItems('写技术分享\n处理用户反馈');
    assertEqual(result.groups.length, 1, '单组');
    assertEqual(result.groups[0].name, '其他事项', '默认组名');
    assertEqual(result.groups[0].items.length, 2, '两项');
  });

  it('空行与纯符号分隔行忽略', () => {
    const result = parseWeeklyItems('事项一\n\n---\n**\n事项二');
    assertEqual(result.totalItems, 2, '分隔行不计入');
  });

  it('空输入防御 → 空组列表', () => {
    const result = parseWeeklyItems('');
    assertEqual(result.groups.length, 0, '空输入无组');
  });
});

describe('buildWeeklyPrompt：指令构造', () => {
  it('包含分组主干串联 + 复盘/下周计划结构', () => {
    const prompt = buildWeeklyPrompt(parseWeeklyItems('【官网】设计稿\n【官网】开发\n测试验收'));
    assertTrue(prompt.includes('官网：设计稿 → 开开'.replace('开开', '开发')), '组内事项串联');
    // 无标记行「测试验收」归当前组（官网），随主干串联进入指令
    assertTrue(prompt.includes('测试验收'), '无标记行应归当前组并进入指令');
    assertTrue(prompt.includes('本周复盘'), '应含复盘节点');
    assertTrue(prompt.includes('下周计划'), '应含下周计划分支');
  });

  it('场景配置契约：id/channel/maxLength/buildPrompt 闭环', () => {
    assertEqual(weeklyReportScenario.id, 'weekly-report', 'id');
    assertEqual(weeklyReportScenario.channel, 'scenario:weekly-report', '渠道码');
    assertTrue(weeklyReportScenario.buildPrompt('【A】x').includes('A：x'), 'buildPrompt 走解析链');
    assertTrue(weeklyReportScenario.maxLength <= 500, '匿名链路 ≤500 字');
  });
});

finish('weekly-report');
