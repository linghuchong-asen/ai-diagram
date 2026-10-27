// 语图增长快赢批次一(QW1) - 前端增长事件上报端点
// 背景:分享页 CTA 点击等"访客侧"动作发生在浏览器,服务端无法感知;
//       本端点承接这类轻量事件,与 GrowthEventService 同格式落 GROWTH_EVENT 日志。
// 安全边界(公开端点三道闸):
//   1) IP 限流:复用 projectShare 的 ShareRateLimitGuard(同款进程内固定窗口);
//   2) 事件白名单:仅允许下方 CLIENT_EVENT_WHITELIST 中的事件,其余一律 400,
//      防止被当万能日志接口灌垃圾;
//   3) 字段收敛:仅接受可选 token/channel 两个字符串,超长截断,其余字段丢弃。
// 白名单演进:快赢批次一(share_cta_click/share_template_click) →
//   魔性传播批次一(card_export / fun_chip_click / digest_submit) →
//   Round E(mind_complete) → 场景工厂(scenario_submit,channel 区分场景,加场景零白名单改动) →
//   社区模板批次(community_template_click,卡片点击 → /share/:token 转化漏斗最后一环)。
import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ShareRateLimitGuard } from '../operationalModules/projectShare/share-rate-limit.guard';
import { GrowthEventService } from './growth-event.service';

/** 允许上报的事件白名单(与前端入口约定;扩事件时两侧同步) */
const CLIENT_EVENT_WHITELIST = new Set([
  'share_cta_click',
  'share_template_click',
  'card_export',
  'fun_chip_click',
  'digest_submit',
  'mind_complete',
  'scenario_submit',
  'community_template_click',
]);

/** 附带字段最大长度(防御性截断,正常 token 32 位 / 渠道码远短于此) */
const FIELD_MAX_LENGTH = 128;

/** 上报请求体(宽松接收,未列出字段直接丢弃) */
interface ClientGrowthEventDto {
  event?: unknown;
  token?: unknown;
  channel?: unknown;
}

/** 字符串清洗:非字符串/空串归一为 undefined,超长截断 */
function sanitizeField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, FIELD_MAX_LENGTH);
}

@Controller('growth')
export class GrowthTrackController {
  constructor(private readonly growthEvent: GrowthEventService) {}

  /**
   * 前端增长事件上报(公开,无需登录)。
   * 永远返回 { accepted: true } 形式的确认(白名单外 400),
   * 埋点属于旁路:内部异常由 track 静默吞掉,不影响前端任何主流程。
   */
  @Post('track')
  @UseGuards(ShareRateLimitGuard)
  track(@Body() dto: ClientGrowthEventDto): { accepted: boolean; event?: string } {
    const event = sanitizeField(dto?.event);
    if (!event || !CLIENT_EVENT_WHITELIST.has(event)) {
      throw new HttpException('未知的事件类型', HttpStatus.BAD_REQUEST);
    }
    const token = sanitizeField(dto?.token);
    const channel = sanitizeField(dto?.channel);
    this.growthEvent.track(event, {
      ...(token ? { token } : {}),
      ...(channel ? { channel } : {}),
    });
    return { accepted: true, event };
  }
}
