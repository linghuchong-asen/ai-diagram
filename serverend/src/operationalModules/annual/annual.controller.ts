// 语图代码年报（Round B）控制器
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/annual/...）：
//   GET /annual/report?source=github|gitee&user=<username>&year=<YYYY>
// 公开端点（免登录 + IP 限流）：年报是获客前锋，访客免注册即可生成与导出卡片。
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ShareRateLimitGuard } from '../projectShare/share-rate-limit.guard';
import { AnnualService, AnnualSource } from './annual.service';

@Controller('annual')
export class AnnualController {
  constructor(private readonly annualService: AnnualService) {}

  /** 年度公开仓库统计：入参非法/用户不存在等由 service 抛出统一 HttpException */
  @Get('report')
  @UseGuards(ShareRateLimitGuard)
  async getReport(
    @Query('source') source: string,
    @Query('user') user: string,
    @Query('year') year: string,
  ) {
    // year 缺省为当前年份（年底/年初跨年时用户大概率想看刚过去的年份，取当前年即可）
    const parsedYear = Number(year) || new Date().getFullYear();
    return this.annualService.getReport(
      (source as AnnualSource) ?? 'github',
      String(user ?? ''),
      parsedYear,
    );
  }
}
