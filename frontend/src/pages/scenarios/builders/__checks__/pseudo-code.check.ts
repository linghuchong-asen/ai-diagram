// 语图 Round I（伪代码解析 builder）可执行断言脚本
// 覆盖：中英文关键字识别、缩进层级、注释/空行忽略、结构统计、
//      指令含拓扑要求（分支/循环/输入输出/顺序）、空输入防御。
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/pseudo-code.check.ts

import { buildPseudoPrompt, parsePseudoCode, parsePseudoLine, pseudoCodeScenario } from '../pseudo-code';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('parsePseudoLine：单行识别', () => {
  it('中文关键字：如果/否则/当/输入/输出/结束', () => {
    assertEqual(parsePseudoLine('如果 a > b')?.kind, 'branch', '如果→分支');
    assertEqual(parsePseudoLine('否则')?.kind, 'branch', '否则→分支');
    assertEqual(parsePseudoLine('当 i < n')?.kind, 'loop', '当→循环');
    assertEqual(parsePseudoLine('输入 x')?.kind, 'io-in', '输入');
    assertEqual(parsePseudoLine('输出结果')?.kind, 'io-out', '输出');
    assertEqual(parsePseudoLine('结束')?.kind, 'end', '结束');
  });

  it('英文关键字兼容（大小写不敏感）：if/else/while/print', () => {
    assertEqual(parsePseudoLine('IF x then')?.kind, 'branch', 'if');
    assertEqual(parsePseudoLine('ELSE')?.kind, 'branch', 'else');
    assertEqual(parsePseudoLine('while i > 0')?.kind, 'loop', 'while');
    assertEqual(parsePseudoLine('print result')?.kind, 'io-out', 'print');
  });

  it('普通语句为 plain；空行与注释行返回 null', () => {
    assertEqual(parsePseudoLine('交换两数')?.kind, 'plain', '普通行');
    assertEqual(parsePseudoLine(''), null, '空行');
    assertEqual(parsePseudoLine('// 注释'), null, '双斜杠注释');
    assertEqual(parsePseudoLine('# 注释'), null, '井号注释');
  });

  it('缩进层级：2 空格 = 1 级，4 空格 = 2 级，Tab 按 2 空格折算', () => {
    assertEqual(parsePseudoLine('  交换两数')?.indent, 1, '2 空格 1 级');
    assertEqual(parsePseudoLine('    交换两数')?.indent, 2, '4 空格 2 级');
    assertEqual(parsePseudoLine('\t交换两数')?.indent, 1, 'Tab 折算 1 级');
  });
});

describe('parsePseudoCode：结构统计', () => {
  it('分支/循环/输入输出计数与最大缩进', () => {
    const summary = parsePseudoCode(
      '输入 a b\n如果 a > b\n  输出 a\n否则\n  输出 b\n当 i < 3\n  i 加一',
    );
    assertEqual(summary.lines.length, 7, '7 个有效行');
    assertEqual(summary.branchCount, 2, '2 处分支（如果+否则）');
    assertEqual(summary.loopCount, 1, '1 处循环');
    assertEqual(summary.ioCount, 3, '3 处输入输出');
    assertEqual(summary.maxIndent, 1, '最大缩进 1 级');
  });
});

describe('buildPseudoPrompt：指令构造', () => {
  it('含分支拓扑要求与菱形节点话术', () => {
    const prompt = buildPseudoPrompt(parsePseudoCode('如果 x\n  输出 1\n否则\n  输出 2'));
    assertTrue(prompt.includes('2 处条件分支'), '分支计数进入指令');
    assertTrue(prompt.includes('菱形'), '菱形判断节点要求');
    assertTrue(prompt.includes('是/否'), '分支出口标注');
  });

  it('含循环回流要求', () => {
    const prompt = buildPseudoPrompt(parsePseudoCode('当 i < n\n  i 加一'));
    assertTrue(prompt.includes('1 处循环'), '循环计数进入指令');
    assertTrue(prompt.includes('回流'), '循环体回流要求');
  });

  it('纯顺序结构：降级为一条主线话术', () => {
    const prompt = buildPseudoPrompt(parsePseudoCode('第一步\n第二步'));
    assertTrue(prompt.includes('纯顺序结构'), '顺序结构降级话术');
  });

  it('空输入防御：不抛错且指令结构完整', () => {
    const prompt = buildPseudoPrompt(parsePseudoCode(''));
    assertTrue(prompt.includes('标准流程图'), '仍输出可用指令');
  });

  it('场景配置契约闭环', () => {
    assertEqual(pseudoCodeScenario.id, 'pseudo-code', 'id');
    assertEqual(pseudoCodeScenario.channel, 'scenario:pseudo-code', '渠道码');
    assertTrue(
      pseudoCodeScenario.buildPrompt('输入 x\n输出 x').includes('输入 x'),
      'buildPrompt 走解析链',
    );
  });
});

finish('pseudo-code');
