import { Controller, Delete, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SkipInterceptor } from './core/interceptor/skip.interceptor';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    // TypeORM 默认连接已由全局模块导出，可直接注入 DataSource
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  getHello(): string {
    // 因为在service文件中使用@Injectable()装饰器，所以这里可以直接调用service中的方法
    return this.appService.getHello();
  }

  /**
   * 存活探针（商业化首发新增）：DB 连通性检查。
   * 消费方：docker healthcheck（每 15s）、巡检脚本、外部监控。
   * 经 nginx 访问路径为 /api/health；跳过 TransformInterceptor 输出裸 JSON，便于监控解析。
   */
  @Get('health')
  @SkipInterceptor()
  async health(): Promise<{ status: string; db: string; uptimeSeconds: number }> {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', db: 'up', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Delete()
  delete(){}
}
