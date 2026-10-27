// 语图技术方案 - 时间线自然排序断言脚本（competitor-driven-evolution-batch Round 7）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/timeline-sort.check.ts
// 覆盖：Day/第N天/D1、钟点、时段词、Day+时段组合、周序、星期、日期、
//       中文数字、不可解析置后保持原序、稳定性、纯函数。
import { parseTimeKey, sortTimelineEvents } from '../artifacts/timeline-sort';
import type { TimelineDraft } from '../../../utils/aiClient';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

function eventsOf(times: string[]): TimelineDraft {
  return { events: times.map((time, i) => ({ time, title: `事件${i + 1}` })) };
}

describe('① 排序键解析（Round 7）', () => {
  it('Day1/D1/第1天/第一天 归一到同一主键', () => {
    const d1 = parseTimeKey('Day1 上午')!;
    assertEqual(parseTimeKey('D1')!.major, d1.major, 'D1 = Day1');
    assertEqual(parseTimeKey('第1天')!.major, d1.major, '第1天 = Day1');
    assertEqual(parseTimeKey('第一天')!.major, d1.major, '中文数字 = Day1');
    assertEqual(parseTimeKey('Day3')!.major > parseTimeKey('Day2')!.major, true, 'Day 递增');
  });

  it('钟点:09:30 < 14:00 < 晚上9点(时段优先于钟点推导)', () => {
    const morning = parseTimeKey('09:30')!;
    const noonish = parseTimeKey('14:00')!;
    const night = parseTimeKey('晚上9点')!;
    assertEqual(morning.slot, 1, '9:30 推导为上午');
    assertEqual(noonish.slot, 3, '14:00 推导为下午');
    assertEqual(night.slot, 5, '晚上时段词');
    assertTrue(night.slot > noonish.slot && noonish.slot > morning.slot, '时段序正确');
    assertEqual(night.minutes, 540, '晚上9点 = 570? 不,9点=540 分钟');
  });

  it('日期:10月1日 < 10月3日;带年份归一', () => {
    const a = parseTimeKey('10月1日')!;
    const b = parseTimeKey('10月3日')!;
    assertTrue(a.major < b.major, '日期序');
    const y = parseTimeKey('2026-10-26')!;
    assertEqual(y.major, 20261026, 'ISO 日期归一为数值主键');
  });

  it('周序与星期:第1周<第2周;周一<周三<周日', () => {
    assertTrue(parseTimeKey('第1周 周一')!.major < parseTimeKey('第2周 周五')!.major, '周序');
    assertTrue(parseTimeKey('周一')!.major < parseTimeKey('周三')!.major, '周内序');
    assertTrue(parseTimeKey('周日')!.major > parseTimeKey('周六')!.major, '周日最末');
  });
});

describe('② 事件排序主流程（Round 7）', () => {
  it('乱序 Day + 时段混排 → 正确排序(Day 主导,时段次之)', () => {
    const result = sortTimelineEvents(eventsOf(['Day2 上午', 'Day1 晚上', 'Day1 上午', 'Day3 09:00']));
    assertEqual(
      result.events.map((e) => e.time).join('|'),
      'Day1 上午|Day1 晚上|Day2 上午|Day3 09:00',
      '三级键排序',
    );
    assertTrue(result.allParsed, '全部可解析');
  });

  it('纯钟点(同日场景)按时间排序', () => {
    const result = sortTimelineEvents(eventsOf(['20:00 晚饭', '09:00 早餐', '14:30 下午茶']));
    assertEqual(result.events[0]?.time, '09:00 早餐', '最早');
    assertEqual(result.events[2]?.time, '20:00 晚饭', '最晚');
  });

  it('无法解析的时间保持原相对顺序并置后,有 warning', () => {
    const result = sortTimelineEvents(eventsOf(['待定', 'Day1 上午', '另行安排', 'Day1 下午']));
    assertEqual(result.events.map((e) => e.time).join('|'), 'Day1 上午|Day1 下午|待定|另行安排', '可解析在前,不可解析按原序置后');
    assertTrue(!result.allParsed, '应提示未全解析');
    assertEqual(result.warnings.length, 2, '两条 warning');
  });

  it('完全同键事件保持原序(稳定排序)', () => {
    const result = sortTimelineEvents(eventsOf(['Day1 上午', 'Day1 上午']));
    assertEqual(result.events[0]?.title, '事件1', '稳定');
    assertEqual(result.events[1]?.title, '事件2', '稳定');
  });

  it('纯函数:不改入参、同输入同输出', () => {
    const draft = eventsOf(['Day2', 'Day1']);
    const snapshot = JSON.stringify(draft);
    sortTimelineEvents(draft);
    assertEqual(JSON.stringify(draft), snapshot, '不改入参');
    assertEqual(
      JSON.stringify(sortTimelineEvents(draft)),
      JSON.stringify(sortTimelineEvents(draft)),
      '确定性',
    );
  });
});

finish('时间线自然排序（timeline-sort.check · Round 7）');
