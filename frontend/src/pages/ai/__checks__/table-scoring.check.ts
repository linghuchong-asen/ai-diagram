// 语图技术方案 - 表格加权打分断言脚本（competitor-driven-evolution-batch Round 6）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/table-scoring.check.ts
// 覆盖：单元格评分（数值/等级词/星级/—）、min-max 归一、成本列方向翻转、权重影响、
//       排除列/无区分度/不可打分防御、推荐结论。
import { scoreTable, scoreCell } from '../artifacts/table-scoring';
import type { TableDraft } from '../../../utils/aiClient';
import { describe, it, finish, assertTrue, assertEqual, assertClose } from './check-util';

/** 基准样例:2 方案 × 3 维度(可手算;A 三维全占优:成本更低/工期更短/质量更高) */
function sampleTable(): TableDraft {
  return {
    columns: ['方案', '成本', '工期', '质量'],
    rows: [
      ['方案A', '10', '1', '高'],
      ['方案B', '20', '2', '低'],
    ],
  };
}

describe('① 单元格评分原语（Round 6）', () => {
  it('数值(含单位/货币/千分位) → 数;等级词 → 3/2/1;星级计数', () => {
    assertEqual(scoreCell('12万'), 12, '万单位取数');
    assertEqual(scoreCell('¥1,200'), 1200, '货币+千分位');
    assertEqual(scoreCell('3.5'), 3.5, '小数');
    assertEqual(scoreCell('高'), 3, '高');
    assertEqual(scoreCell('中等'), 2, '中');
    assertEqual(scoreCell('很低'), 1, '低');
    assertEqual(scoreCell('★★★'), 3, '三星');
  });

  it('「—」/空/无法解析文本 → null(不猜测)', () => {
    assertEqual(scoreCell('—'), null, '占位符');
    assertEqual(scoreCell('   '), null, '空白');
    assertEqual(scoreCell('视情况而定'), null, '不可解析文本');
  });
});

describe('② 加权打分主流程（Round 6）', () => {
  it('基准样例:等权 + 成本/工期方向自动翻转,方案A 全维度占优 → 1.00 vs 0.00', () => {
    const result = scoreTable(sampleTable());
    assertTrue(result.scored, '应可打分');
    const a = result.rows.find((r) => r.head === '方案A')!;
    const b = result.rows.find((r) => r.head === '方案B')!;
    assertClose(a.total, 1.0, 'A 总分', 1e-9);
    assertClose(b.total, 0.0, 'B 总分', 1e-9);
    assertEqual(result.rows[0]?.head, '方案A', '按总分降序');
    assertTrue(result.advice!.includes('方案A'), '推荐结论指向最高分');
  });

  it('方向翻转验证:成本列数值越小得分越高', () => {
    const result = scoreTable(sampleTable());
    const a = result.rows.find((r) => r.head === '方案A')!;
    const cost = a.breakdown.find((b) => b.column === '成本')!;
    // A 成本 10 < B 成本 20,lower-better → A 归一分 1.0
    assertClose(cost.normalized ?? -1, 1.0, '成本低者归一分应为 1');
    const quality = a.breakdown.find((b) => b.column === '质量')!;
    assertClose(quality.normalized ?? -1, 1.0, '质量高者归一分应为 1');
  });

  it('权重影响:把质量权重拉满可逆转推荐', () => {
    // 方案B 质量低(0)但若把成本/工期权重清零、只看质量?这里构造 B 质量更高的表
    const table: TableDraft = {
      columns: ['方案', '成本', '质量'],
      rows: [
        ['甲', '10', '低'],
        ['乙', '20', '高'],
      ],
    };
    // 等权:甲 成本1+质量0=0.5;乙 成本0+质量1=0.5 → 并列
    const equal = scoreTable(table);
    assertTrue(equal.advice!.includes('并列'), '等权应并列');
    // 权重 {成本:3,质量:1}:甲=(3*1+1*0)/4=0.75 → 甲胜
    const weighted = scoreTable(table, { weights: { 成本: 3, 质量: 1 } });
    assertClose(weighted.rows[0]!.total, 0.75, '加权总分');
    assertTrue(weighted.advice!.includes('甲'), '推荐应随权重改变');
  });

  it('方向可显式覆盖(把成本列当越高越好)', () => {
    const result = scoreTable(sampleTable(), { direction: { 成本: 'higher' } });
    const a = result.rows.find((r) => r.head === '方案A')!;
    const cost = a.breakdown.find((b) => b.column === '成本')!;
    assertClose(cost.normalized ?? -1, 0.0, '覆盖后 A 成本(10,最小)归一为 0');
  });

  it('排除列:excludeColumns 与权重 0 均剔除;「—」整列剔除并 warning', () => {
    const table: TableDraft = {
      columns: ['方案', '成本', '备注', '风险'],
      rows: [
        ['甲', '10', '老供应商', '—'],
        ['乙', '20', '新供应商', '—'],
      ],
    };
    const result = scoreTable(table, { excludeColumns: ['备注'] });
    assertTrue(result.scored, '仍可打分');
    const a = result.rows[0]!;
    // 风险列全为 — → 排除;备注显式排除 → 只剩成本
    assertEqual(a.breakdown.length, 1, '仅成本列参与');
    assertTrue(result.warnings.some((w) => w.includes('风险')), '「—」整列应有 warning');
    assertTrue(result.warnings.some((w) => w.includes('备注')) || !a.breakdown.some((b) => b.column === '备注'), '备注列不参与');
  });

  it('全列同值 → 0.5 无区分度 warning;不可打分表 → scored=false', () => {
    const same: TableDraft = {
      columns: ['方案', '质量'],
      rows: [
        ['甲', '高'],
        ['乙', '高'],
      ],
    };
    const result = scoreTable(same);
    assertClose(result.rows[0]!.total, 0.5, '同值按 0.5');
    assertTrue(result.warnings.some((w) => w.includes('无区分度')), '无区分度 warning');

    const unscoreable: TableDraft = {
      columns: ['方案', '备注'],
      rows: [
        ['甲', '视情况'],
        ['乙', '再议'],
      ],
    };
    const failed = scoreTable(unscoreable);
    assertTrue(!failed.scored, '无文本可评分列应 scored=false');
    assertTrue(failed.warnings.some((w) => w.includes('没有可打分的列')), '原因说明');
  });

  it('纯函数:不改入参、同输入同输出', () => {
    const table = sampleTable();
    const snapshot = JSON.stringify(table);
    scoreTable(table);
    assertEqual(JSON.stringify(table), snapshot, '不改入参');
    assertEqual(JSON.stringify(scoreTable(table)), JSON.stringify(scoreTable(table)), '确定性');
  });
});

finish('表格加权打分（table-scoring.check · Round 6）');
