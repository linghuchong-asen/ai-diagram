// 语图商业化首发 - 增长事件埋点单测(Task 4)
// 覆盖:track 输出格式精确匹配(GROWTH_EVENT 前缀 + 可解析 JSON 含 event/ts)
import { customLogger } from '../utils/log/logger.service';
import { GrowthEventService } from './growth-event.service';

describe('GrowthEventService（Task 4 增长埋点）', () => {
  it('track 输出格式:GROWTH_EVENT 前缀 + JSON 可解析,含 event/ts,props 合并', () => {
    const spy = jest.spyOn(customLogger, 'log').mockImplementation(() => undefined);
    try {
      const svc = new GrowthEventService();
      svc.track('generate', { userId: 'u1', mode: 'real' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [msg] = spy.mock.calls[0];
      expect(String(msg).startsWith('GROWTH_EVENT ')).toBe(true);

      const payload = JSON.parse(String(msg).slice('GROWTH_EVENT '.length));
      expect(payload.event).toBe('generate');
      expect(payload.userId).toBe('u1');
      expect(payload.mode).toBe('real');
      // ts 为 ISO 时间串(后续 grep 聚合按行解析依赖)
      expect(typeof payload.ts).toBe('string');
      expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
    } finally {
      spy.mockRestore();
    }
  });

  it('track 无 props → 单行仍含 event 与 ts,格式可解析', () => {
    const spy = jest.spyOn(customLogger, 'log').mockImplementation(() => undefined);
    try {
      new GrowthEventService().track('share_create');
      const [msg] = spy.mock.calls[0];
      const payload = JSON.parse(String(msg).slice('GROWTH_EVENT '.length));
      expect(payload).toMatchObject({ event: 'share_create' });
      expect(typeof payload.ts).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('track 是旁路:序列化异常(circular)不抛错,不影响主链路', () => {
    const svc = new GrowthEventService();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => svc.track('bad', circular)).not.toThrow();
  });
});
