import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ProjectSearchService } from './project_search.service';
import { JwtAuthGuard } from 'src/auth/auth.guard';

@Controller('projectSearch')
export class ProjectSearchController {
  constructor(private readonly searchService: ProjectSearchService) {}

  /**
   * 全文检索：GET /projectSearch/search?q=关键词&limit=20
   * 响应经全局 TransformInterceptor 包装为 { code, data: { list, total, query }, message }
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.searchService.search(q, limit);
  }

  /**
   * 兼容旧路由：GET /projectSearch?searchWord=xxx（也接受 q）
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getProjectList(
    @Query('q') q: string,
    @Query('searchWord') searchWord: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.search(q || searchWord, limit);
  }

  /**
   * 存量数据回填索引：POST /projectSearch/rebuild
   * 索引表是派生数据，项目/文档历史数据不会自动进索引，接线后执行一次即可
   */
  @Post('rebuild')
  @UseGuards(JwtAuthGuard)
  async rebuild() {
    return this.searchService.rebuildAll();
  }
}
