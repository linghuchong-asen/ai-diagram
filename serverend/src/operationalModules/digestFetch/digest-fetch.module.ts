// 语图 Round J - 网页链接抓取控制器与模块
// 路由（经 nginx 剥离 /api 前缀后对外为 /api/digest/...）：
//   POST /digest/url  { url }  抓取网页正文（公开，IP 限流，防 SSRF）
import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ShareRateLimitGuard } from '../projectShare/share-rate-limit.guard';
import { DigestFetchService } from './digest-fetch.service';

@Controller('digest')
export class DigestFetchController {
  constructor(private readonly digestFetch: DigestFetchService) {}

  /** 入口校验：url 字段必填（服务内再做协议/内网校验） */
  @Post('url')
  @UseGuards(ShareRateLimitGuard)
  async fetchUrl(@Body() body: { url?: unknown }): Promise<{ title: string; text: string; truncated: boolean }> {
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      throw new HttpException('url 不能为空', HttpStatus.BAD_REQUEST);
    }
    return this.digestFetch.fetchUrlText(url);
  }
}

@Module({
  controllers: [DigestFetchController],
  providers: [DigestFetchService],
  exports: [DigestFetchService],
})
export class DigestFetchModule {}
