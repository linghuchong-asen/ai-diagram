// 语图 Task 7 - 模板中心控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/template/...）：
//   GET  /template/list                 公开读取预置模板列表（无需登录，仅限流守卫）
//   POST /template/submit/:projectId    社区模板投稿（需登录 + 归属校验，社区模板批次）
//   GET  /template/community            社区精选列表（公开已上架，仅限流守卫）
//   GET  /template/community/pending    待审列表（仅 role=root）
//   POST /template/community/review/:id 审核（仅 role=root，approve/reject）
// 鉴权说明：本模块守卫为 opt-in —— 未挂 JwtAuthGuard 的路由天然公开
// （项目未使用 APP_GUARD 全局守卫，与 /share/view/:token 同机制）。
// TemplateRateLimitGuard 经 @UseGuards(类) 直接实例化，无需注册 provider。
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
import { CommunityTemplateEntity } from './entities/community-template.entity';
import { FlowTemplate, TemplateService } from './template.service';
import { TemplateRateLimitGuard } from './template-rate-limit.guard';
import { JwtAuthGuard } from '../../auth/auth.guard';

/** 带 JWT payload 的请求（JwtStrategy.validate 返回完整用户实体） */
type AuthedRequest = Request & {
  user?: { id?: string | number; role?: string; nickname?: string };
};

@Controller('template')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  private currentUserId(req: AuthedRequest): string | undefined {
    return req?.user?.id != null ? String(req.user.id) : undefined;
  }

  /** 公开读取：静态预置 12 个高频模板（访客可浏览，点击模板跳试用页转化） */
  @Get('list')
  @UseGuards(TemplateRateLimitGuard)
  listTemplates(): FlowTemplate[] {
    return this.templateService.listTemplates();
  }

  /** 社区模板投稿（需登录 + 归属校验）：审核通过后上架模板中心「社区精选」 */
  @Post('submit/:projectId')
  @UseGuards(JwtAuthGuard)
  async submitCommunity(
    @Param('projectId') projectId: string,
    @Req() req: AuthedRequest,
    @Body() body: { description?: string },
  ): Promise<CommunityTemplateEntity> {
    return this.templateService.submitCommunity(
      this.currentUserId(req),
      projectId,
      typeof body?.description === 'string' ? body.description : undefined,
      req?.user?.nickname,
    );
  }

  /** 社区精选（公开）：仅已上架模板，访客可浏览 */
  @Get('community')
  @UseGuards(TemplateRateLimitGuard)
  async listCommunity() {
    return this.templateService.listCommunity();
  }

  /** 我的社区作品（需登录，投稿者数据面板）：审核状态 + 热度反馈 */
  @Get('community/mine')
  @UseGuards(JwtAuthGuard)
  async listMyCommunity(@Req() req: AuthedRequest) {
    return this.templateService.listMyCommunity(this.currentUserId(req));
  }

  /** 待审列表（仅 root）：非 root 统一 403 */
  @Get('community/pending')
  @UseGuards(JwtAuthGuard)
  async listPending(@Req() req: AuthedRequest): Promise<CommunityTemplateEntity[]> {
    if (req?.user?.role !== 'root') {
      throw new HttpException('无权访问审核队列', HttpStatus.FORBIDDEN);
    }
    return this.templateService.listCommunityPending();
  }

  /** 审核（仅 root）：body.approve=true 上架 / false 驳回 */
  @Post('community/review/:id')
  @UseGuards(JwtAuthGuard)
  async review(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Body() body: { approve?: boolean },
  ): Promise<CommunityTemplateEntity> {
    if (req?.user?.role !== 'root') {
      throw new HttpException('无权审核', HttpStatus.FORBIDDEN);
    }
    return this.templateService.reviewCommunity(id, body?.approve === true);
  }
}
