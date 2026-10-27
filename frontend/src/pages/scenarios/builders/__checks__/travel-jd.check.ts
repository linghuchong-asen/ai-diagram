// 语图 Round K/L（行程图 + JD 面试）可执行断言脚本
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/travel-jd.check.ts

import {
  buildItineraryPrompt,
  parseItinerary,
  travelScenario,
} from '../travel';
import { buildJdPrompt, parseJd, jdInterviewScenario } from '../jd-interview';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('parseItinerary：行程解析（Round K）', () => {
  it('Day1/D1/第1天 多种标记开组 + 同日归并', () => {
    const result = parseItinerary('Day1: 机场 → 酒店\nD2: 迪士尼\n第1天: 夜游外滩');
    assertEqual(result.days.length, 2, 'Day1 与 第1天 应归并为同一天');
    assertEqual(result.days[0].label, 'Day1', '标签归一');
    assertEqual(result.days[0].items.join('|'), '机场 → 酒店|夜游外滩', '同日条目归并');
    assertEqual(result.days[1].label, 'Day2', 'D2 归一');
  });

  it('中文数字天数（第三天）；天数后的无标记行归该天（当前组）', () => {
    const result = parseItinerary('第三天: 返程\n自由活动');
    assertEqual(result.days[0].label, 'Day3', '中文数字转阿拉伯');
    // 「自由活动」无标记 → 归当前天（Day3），空默认组被清理
    assertEqual(result.days.length, 1, '空默认组应被清理');
    assertEqual(result.days[0].items.join('|'), '返程|自由活动', '无标记行归当前天');
  });

  it('移动路线（含 → 的行）被收集', () => {
    const result = parseItinerary('Day1: A → B → C');
    assertEqual(result.moves.length, 1, '移动行收集');
  });

  it('空行与纯符号行忽略；空输入防御', () => {
    assertEqual(parseItinerary('---\n**').totalItems, 0, '分隔行忽略');
    assertEqual(parseItinerary('').days.length, 1, '空输入仅默认组');
  });

  it('指令含按天分组与泳道要求；配置契约闭环', () => {
    const prompt = buildItineraryPrompt(parseItinerary('Day1: A → B'));
    assertTrue(prompt.includes('Day1'), '天数进入指令');
    assertTrue(prompt.includes('泳道'), '泳道结构要求');
    assertEqual(travelScenario.id, 'travel', 'id');
    assertTrue(travelScenario.buildPrompt('Day1: A → B').includes('Day1'), 'buildPrompt 走解析链');
  });
});

describe('parseJd：JD 解析（Round L）', () => {
  const sampleJd =
    '岗位职责：负责电商平台后端服务开发与维护。\n任职要求：3 年以上 Java 开发经验，本科及以上学历；' +
    '熟悉 Spring、MySQL、Redis，了解 Kafka 与分布式系统；具备良好的沟通能力与团队协作精神。';

  it('技术栈词典命中（Java/Spring/MySQL/Redis/Kafka/分布式）', () => {
    const result = parseJd(sampleJd);
    for (const skill of ['Java', 'Spring', 'MySQL', 'Redis', 'Kafka', '分布式']) {
      assertTrue(result.skills.includes(skill), `${skill} 应命中`);
    }
  });

  it('软技能命中 + 经验/学历提取', () => {
    const result = parseJd(sampleJd);
    assertTrue(result.softSkills.includes('沟通'), '沟通命中');
    assertTrue((result.softSkills ?? []).includes('协作') || result.softSkills.length > 0, '软技能非空');
    assertTrue(String(result.experience).includes('3 年'), '经验 3 年');
    assertEqual(result.education, '本科', '学历本科');
  });

  it('单词边界：含 Java 的文本不误命中 aJavaX 之外的词（Script 前缀防御）', () => {
    const result = parseJd('需要 JavaScript 与 Java 双栈');
    assertTrue(result.skills.includes('JavaScript'), 'JavaScript 命中');
    assertTrue(result.skills.includes('Java'), 'Java 命中');
  });

  it('非 JD 文本防御：不抛错、考点走降级话术', () => {
    const result = parseJd('今天天气不错');
    assertEqual(result.skills.length, 0, '无命中');
    assertTrue(buildJdPrompt(result).includes('自行提炼'), '降级话术');
  });

  it('指令含作战图结构与 STAR/反问环节；配置契约闭环', () => {
    const prompt = buildJdPrompt(parseJd(sampleJd));
    assertTrue(prompt.includes('技能盘点'), '技能盘点环节');
    assertTrue(prompt.includes('STAR'), 'STAR 复盘');
    assertTrue(prompt.includes('反问'), '反问环节');
    assertEqual(jdInterviewScenario.id, 'jd-interview', 'id');
    assertTrue(jdInterviewScenario.buildPrompt(sampleJd).includes('Spring'), 'buildPrompt 走解析链');
  });
});

finish('travel-jd');
