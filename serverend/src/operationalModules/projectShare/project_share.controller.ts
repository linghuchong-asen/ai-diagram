// 语图 V1.1 - 项目只读分享链接控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/share/...）：
//   POST   /share/project/:projectId  创建分享（需登录，幂等）
//   DELETE /share/project/:projectId  撤销分享（需登录）
//   GET    /share/view/:token         免登录公开读取（仅限流守卫，无 JWT）
// 鉴权说明：本模块守卫为 opt-in —— 未挂 JwtAuthGuard 的路由天然公开
// （项目未使用 APP_GUARD 全局守卫，与 /api/health 同机制）。
import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { ProjectShareService } from './project_share.service';
import { ShareRateLimitGuard } from './share-rate-limit.guard';

/** 带 JWT payload 的请求（AuthGuard('jwt') 校验后挂载 req.user） */
type AuthedRequest = Request & { user?: { id?: string | number } };

@Controller('share')
export class ProjectShareController {
  constructor(private readonly shareService: ProjectShareService) {}

  private currentUserId(req: AuthedRequest): string | undefined {
    return req?.user?.id != null ? String(req.user.id) : undefined;
  }

  /** 创建（幂等）分享链接：返回 token，URL 由前端用 origin 拼接（后端不感知对外域名） */
  @Post('project/:projectId')
  @UseGuards(JwtAuthGuard)
  async createShare(
    @Param('projectId') projectId: string,
    @Req() req: AuthedRequest,
  ): Promise<{ shareToken: string }> {
    const result = await this.shareService.createShare(
      projectId,
      this.currentUserId(req),
    );
    if (!result) {
      throw new HttpException('项目不存在', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /** 撤销分享：token 立即失效（物理删除记录） */
  @Delete('project/:projectId')
  @UseGuards(JwtAuthGuard)
  async revokeShare(
    @Param('projectId') projectId: string,
    @Req() req: AuthedRequest,
  ): Promise<{ revoked: boolean }> {
    const revoked = await this.shareService.revokeShare(
      projectId,
      this.currentUserId(req),
    );
    if (revoked === null) {
      throw new HttpException('项目不存在', HttpStatus.NOT_FOUND);
    }
    return { revoked };
  }

  /** 免登录公开读取：仅项目名 + 画布 JSON + 解锁态（Task 6）；限流防遍历/刷流量 */
  @Get('view/:token')
  @UseGuards(ShareRateLimitGuard)
  async viewShare(
    @Param('token') token: string,
  ): Promise<{ projectName: string; editorData: unknown[]; unlocked: boolean }> {
    return this.shareService.viewShare(token);
  }
}
