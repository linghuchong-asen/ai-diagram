// 语图 Task 7 - 模板中心控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/template/...）：
//   GET /template/list  公开读取预置模板列表（无需登录，仅限流守卫）
// 鉴权说明：本模块守卫为 opt-in —— 未挂 JwtAuthGuard 的路由天然公开
// （项目未使用 APP_GUARD 全局守卫，与 /share/view/:token 同机制）。
// TemplateRateLimitGuard 经 @UseGuards(类) 直接实例化，无需注册 provider。
import { Controller, Get, UseGuards } from '@nestjs/common';
import { FlowTemplate, TemplateService } from './template.service';
import { TemplateRateLimitGuard } from './template-rate-limit.guard';

@Controller('template')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /** 公开读取：静态预置 12 个高频模板（访客可浏览，点击模板跳试用页转化） */
  @Get('list')
  @UseGuards(TemplateRateLimitGuard)
  listTemplates(): FlowTemplate[] {
    return this.templateService.listTemplates();
  }
}
