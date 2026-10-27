// 语图留存与裂变加强批次 - 每日签到控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/ai/checkin）：
//   GET  /ai/checkin   签到状态（今日是否已签 + 连续天数）
//   POST /ai/checkin   签到（当日首次发奖，重复签到幂等）
// 鉴权：JWT（签到是登录用户权益，试用态不开放）。
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { CheckinService, CheckinStatusView, CheckinResultView } from './checkin.service';

/** 带 JWT payload 的请求（AuthGuard('jwt') 校验后挂载 req.user） */
type AuthedRequest = Request & { user?: { id?: string | number } };

@Controller('ai/checkin')
export class CheckinController {
  constructor(private readonly checkinService: CheckinService) {}

  private currentUserId(req: AuthedRequest): string | undefined {
    return req?.user?.id != null ? String(req.user.id) : undefined;
  }

  /** 签到状态（浮窗配额栏渲染用） */
  @Get()
  @UseGuards(JwtAuthGuard)
  async status(@Req() req: AuthedRequest): Promise<CheckinStatusView> {
    return this.checkinService.status(this.currentUserId(req));
  }

  /** 签到（幂等）：当日首次发额度奖励，连签满 7 天整数倍送会员天数 */
  @Post()
  @UseGuards(JwtAuthGuard)
  async checkin(@Req() req: AuthedRequest): Promise<CheckinResultView> {
    return this.checkinService.checkin(this.currentUserId(req));
  }
}
