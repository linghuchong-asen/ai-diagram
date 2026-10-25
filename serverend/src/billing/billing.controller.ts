// 语图 Task 6 - 按次付费解锁控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/billing/...）：
//   POST /billing/unlock/:projectId    创建解锁订单（需登录，金额由服务端定价）
//   GET  /billing/order/:orderId       查询本人订单（需登录 + 归属校验）
//   POST /billing/notify/xunhupay      虎皮椒支付结果回调（公开端点，无 JWT，安全靠 MD5 验签）
// 鉴权说明：本模块守卫为 opt-in —— 未挂 JwtAuthGuard 的路由天然公开
// （项目未使用 APP_GUARD 全局守卫，与 projectShare 同机制）。
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SkipInterceptor } from '../core/interceptor/skip.interceptor';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
import {
  BillingService,
  CreateUnlockOrderResult,
  UnlockOrderView,
} from './billing.service';

/** 带 JWT payload 的请求（AuthGuard('jwt') 校验后挂载 req.user） */
type AuthedRequest = Request & { user?: { id?: string | number } };

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  private currentUserId(req: AuthedRequest): string | undefined {
    return req?.user?.id != null ? String(req.user.id) : undefined;
  }

  /** 创建解锁订单：金额服务端定价；origin 取浏览器 Origin 头，用于支付完成回跳 */
  @Post('unlock/:projectId')
  @UseGuards(JwtAuthGuard)
  async createUnlockOrder(
    @Param('projectId') projectId: string,
    @Req() req: AuthedRequest,
  ): Promise<CreateUnlockOrderResult> {
    const origin = Array.isArray(req?.headers?.origin)
      ? req.headers.origin[0]
      : req?.headers?.origin;
    return this.billingService.createUnlockOrder(
      this.currentUserId(req),
      projectId,
      origin,
    );
  }

  /** 查询本人订单：归属校验在 service 内完成，越权统一 404 */
  @Get('order/:orderId')
  @UseGuards(JwtAuthGuard)
  async queryOrder(
    @Param('orderId') orderId: string,
    @Req() req: AuthedRequest,
  ): Promise<UnlockOrderView> {
    return this.billingService.queryOrder(this.currentUserId(req), orderId);
  }

  /**
   * 虎皮椒支付结果回调（公开端点）：
   *   - 验签成功 → 纯文本 'ok'（虎皮椒要求的确认应答，@SkipInterceptor 绕过
   *     {code,data} 包装，与 /health 裸响应同机制）；
   *   - 验签失败 → 400（网关将按其策略重试）。
   */
  @Post('notify/xunhupay')
  @Public() // 公开回调：虎皮椒服务器直连，无法携带用户令牌；安全靠 MD5 验签
  @SkipInterceptor()
  async notifyXunhupay(
    @Body() body: unknown,
  ): Promise<string> {
    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const ok = await this.billingService.handleNotify(payload);
    if (!ok) {
      throw new HttpException('验签失败', HttpStatus.BAD_REQUEST);
    }
    return 'ok';
  }
}
