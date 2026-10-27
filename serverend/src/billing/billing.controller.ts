// 语图 - 计费控制器：按次解锁（Task 6）+ 会员月卡 + 支付回调 + 营收看板（商业化闭环批次）
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/billing/...）：
//   POST /billing/unlock/:projectId    创建解锁订单（需登录，金额由服务端定价）
//   GET  /billing/order/:orderId       查询本人解锁订单（需登录 + 归属校验）
//   POST /billing/vip/order            创建会员月卡订单（需登录，商业化闭环批次）
//   GET  /billing/vip/order/:orderId   查询本人会员订单（需登录 + 归属校验）
//   GET  /billing/vip/status           当前会员状态（需登录）
//   GET  /billing/invite/me            邀请活动页数据（需登录，邀请裂变批次）
//   POST /billing/notify/xunhupay      虎皮椒支付结果回调（公开端点，无 JWT，安全靠 MD5 验签）
//   POST /billing/notify/mock          模拟支付回调（公开端点，安全靠 HMAC 验签；
//                                      仅 PAY_CHANNEL=mock 且配置 MOCK_PAY_SECRET 时生效）
//   GET  /billing/admin/overview       营收看板（仅 role=root）
// 鉴权说明：本模块守卫为 opt-in —— 未挂 JwtAuthGuard 的路由天然公开
// （项目未使用 APP_GUARD 全局守卫，与 projectShare 同机制）。
import {
  Body,
  Controller,
  ForbiddenException,
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
  AdminRevenueOverview,
  BillingService,
  CreateUnlockOrderResult,
  CreateVipOrderResult,
  UnlockOrderView,
  VipOrderView,
  VipStatusView,
} from './billing.service';

/** 带 JWT payload 的请求（AuthGuard('jwt') 校验后挂载 req.user，JwtStrategy.validate 返回完整用户实体） */
type AuthedRequest = Request & {
  user?: { id?: string | number; role?: string };
};

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

  /** 查询本人解锁订单：归属校验在 service 内完成，越权统一 404 */
  @Get('order/:orderId')
  @UseGuards(JwtAuthGuard)
  async queryOrder(
    @Param('orderId') orderId: string,
    @Req() req: AuthedRequest,
  ): Promise<UnlockOrderView> {
    return this.billingService.queryOrder(this.currentUserId(req), orderId);
  }

  /** 创建会员月卡订单：金额服务端定价；在期会员可重复下单（续费叠加） */
  @Post('vip/order')
  @UseGuards(JwtAuthGuard)
  async createVipOrder(@Req() req: AuthedRequest): Promise<CreateVipOrderResult> {
    const origin = Array.isArray(req?.headers?.origin)
      ? req.headers.origin[0]
      : req?.headers?.origin;
    return this.billingService.createVipOrder(this.currentUserId(req), origin);
  }

  /** 查询本人会员订单：归属校验在 service 内完成，越权统一 404 */
  @Get('vip/order/:orderId')
  @UseGuards(JwtAuthGuard)
  async queryVipOrder(
    @Param('orderId') orderId: string,
    @Req() req: AuthedRequest,
  ): Promise<VipOrderView> {
    return this.billingService.queryVipOrder(this.currentUserId(req), orderId);
  }

  /** 当前会员状态（是否在期 + 到期时间） */
  @Get('vip/status')
  @UseGuards(JwtAuthGuard)
  async getVipStatus(@Req() req: AuthedRequest): Promise<VipStatusView> {
    return this.billingService.getVipStatus(this.currentUserId(req));
  }

  /**
   * 邀请裂变 - 活动页数据（需登录）：邀请码（存量用户懒生成）+ 邀请战果。
   * 前端 /invite 页消费：展示专属链接、已邀请人数与会员到期日。
   */
  @Get('invite/me')
  @UseGuards(JwtAuthGuard)
  async getInviteHome(@Req() req: AuthedRequest) {
    return this.billingService.getInviteHome(this.currentUserId(req));
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

  /**
   * 模拟支付回调（公开端点，沙箱演示用）：
   *   - 前端 /mock-pay 收银台把下单时服务端签发的 orderId+sign POST 回来；
   *   - 通道未启用/验签不过 → 400；通过 → 与真实通道同一放行语义。
   *   - 红线：生产严禁 PAY_CHANNEL=mock（任何人可自我「支付」），见部署手册。
   */
  @Post('notify/mock')
  @Public()
  @SkipInterceptor()
  async notifyMock(@Body() body: unknown): Promise<string> {
    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const ok = await this.billingService.handleMockNotify(payload);
    if (!ok) {
      throw new HttpException('模拟支付验签失败', HttpStatus.BAD_REQUEST);
    }
    return 'ok';
  }

  /**
   * 营收看板（管理端）：三窗口 GMV/订单数 + 在期会员数 + 付费用户数 + 最近订单。
   * 鉴权：JWT + role=root（当前仅运营负责人账号），非 root 统一 403。
   */
  @Get('admin/overview')
  @UseGuards(JwtAuthGuard)
  async adminOverview(@Req() req: AuthedRequest): Promise<AdminRevenueOverview> {
    if (req?.user?.role !== 'root') {
      throw new ForbiddenException('无权访问营收看板');
    }
    return this.billingService.getAdminOverview();
  }
}
