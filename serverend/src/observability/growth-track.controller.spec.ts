// 语图增长事件上报端点单测（快赢批次一 QW1 + 魔性传播批次一白名单扩充）
// 模式：纯逻辑直测（直接 new Controller + 桩 GrowthEventService），守卫属 Nest 层不在此覆盖。
import { HttpException, HttpStatus } from '@nestjs/common';
import { GrowthTrackController } from './growth-track.controller';

function makeController() {
  const track = jest.fn();
  const controller = new GrowthTrackController({ track } as never);
  return { controller, track };
}

describe('GrowthTrackController（前端增长事件上报）', () => {
  it('白名单内事件（share_cta_click）→ 记录并返回 accepted', () => {
    const { controller, track } = makeController();
    const result = controller.track({ event: 'share_cta_click', token: 'tok-1' });
    expect(result).toEqual({ accepted: true, event: 'share_cta_click' });
    expect(track).toHaveBeenCalledWith('share_cta_click', { token: 'tok-1' });
  });

  it('魔性传播批次一新增事件（card_export/fun_chip_click/digest_submit）均在白名单内', () => {
    const { controller, track } = makeController();
    for (const event of ['card_export', 'fun_chip_click', 'digest_submit']) {
      expect(controller.track({ event, channel: 'trial' })).toEqual({
        accepted: true,
        event,
      });
    }
    expect(track).toHaveBeenCalledTimes(3);
  });

  it('Round E：mind_complete 在白名单内且携带原型渠道码', () => {
    const { controller, track } = makeController();
    expect(controller.track({ event: 'mind_complete', channel: 'mind:decision' })).toEqual({
      accepted: true,
      event: 'mind_complete',
    });
    expect(track).toHaveBeenCalledWith('mind_complete', { channel: 'mind:decision' });
  });

  it('场景工厂：scenario_submit 在白名单内（channel 区分场景）', () => {
    const { controller, track } = makeController();
    expect(controller.track({ event: 'scenario_submit', channel: 'scenario:weekly-report' })).toEqual({
      accepted: true,
      event: 'scenario_submit',
    });
    expect(track).toHaveBeenCalledWith('scenario_submit', { channel: 'scenario:weekly-report' });
  });

  it('白名单外事件 → 400 且不记日志（防万能日志接口）', () => {
    const { controller, track } = makeController();
    expect(() => controller.track({ event: 'arbitrary_injection' })).toThrow(HttpException);
    try {
      controller.track({ event: 'another_bad' });
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
    expect(track).not.toHaveBeenCalled();
  });

  it('事件名缺失/非字符串 → 400', () => {
    const { controller } = makeController();
    expect(() => controller.track({})).toThrow(HttpException);
    expect(() => controller.track({ event: 123 })).toThrow(HttpException);
  });

  it('附带字段清洗：非字符串忽略、超长截断 128、空白归一为省略', () => {
    const { controller, track } = makeController();
    controller.track({
      event: 'card_export',
      token: `t-${'a'.repeat(300)}`,
      channel: '   ',
    });
    // 超长截断（128 字符 = "t-" + 126 个 a）；空白字符串清洗为 undefined → 不写入事件字段
    expect(track).toHaveBeenCalledWith('card_export', {
      token: `t-${'a'.repeat(126)}`,
    });
  });

  it('未携带可选字段 → 事件仅含 event 本身', () => {
    const { controller, track } = makeController();
    controller.track({ event: 'digest_submit' });
    expect(track).toHaveBeenCalledWith('digest_submit', {});
  });
});

describe('社区模板批次：community_template_click 在白名单内', () => {
  it('社区模板卡片点击可上报（漏斗：click → share_view → share_duplicate）', () => {
    const { controller, track } = makeController();
    const result = controller.track({ event: 'community_template_click', token: 'tpl-1' });
    expect(result).toEqual({ accepted: true, event: 'community_template_click' });
    expect(track).toHaveBeenCalledWith('community_template_click', { token: 'tpl-1' });
  });
});
