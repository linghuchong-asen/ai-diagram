// 语图技术方案 - AI 接口(思考流式 + 数据一次性)
//   1. POST /api/ai/chat          -> { threadId }(立即返回)
//   2. SSE  /api/ai/think/:id     -> 逐 token 推送思考过程
//   3. GET  /api/ai/result/:id    -> 202 + Retry-After 轮询,就绪返回完整数据
//                                     200 + status='need_confirm' 挂起态(人在回路,Task 9.5)
//   4. POST /api/ai/confirm/:id   -> 提交确认后恢复执行(Task 9.5)
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  Sse,
  Header,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from './ai.service';
import {
  ChatRequestSchema,
  ChatRequest,
  TrialChatRequestSchema,
  TrialChatRequest,
} from './schemas/chat.schema';
import { SkipInterceptor } from '../core/interceptor/skip.interceptor';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
import { QuotaService } from './quota/quota.service';
// Task 3 免登录试用:IP 限流守卫(与类级 JwtAuthGuard 叠加,@Public 豁免鉴权)
import { TrialRateLimitGuard } from './guards/trial-rate-limit.guard';

/** 人在回路确认请求体(Task 9.5) */
export const ConfirmRequestSchema = z.object({
  /** accept = 采用候选方案;retry = 补充约束后重新生成 */
  choice: z.enum(['accept', 'retry'], { message: 'choice 只能是 accept 或 retry' }),
  /** retry 时的补充约束(一句话) */
  instruction: z.string().max(500, '补充约束过长(最多 500 字)').optional(),
  /** 指定候选方案 id(缺省 accept-current) */
  candidateId: z.string().max(64).optional(),
  /** 挂起时下发的恢复令牌(若前端持有则回传,用于防重复提交) */
  resumeToken: z.string().max(128).optional(),
});

export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

/**
 * Task 11.1:AI 端点启用 JWT 鉴权(security.md)。
 * chat / result / confirm 需要登录;think 是 SSE —— 浏览器 EventSource 无法携带
 * Authorization 头,标 @Public() 豁免,threadId(randomUUID)本身作为一次性凭证。
 */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    /** Task 11.5 配额服务:商业化首发暴露当日用量查询(前端 AI 浮窗展示"已用/上限") */
    private readonly quotaService: QuotaService,
  ) {}

  /** 1) 创建线程:立即返回 threadId(userId 以 JWT 为准,配额按用户计量) */
  @Post('chat')
  @SkipInterceptor()
  @Header('Cache-Control', 'no-store')
  async chat(@Body() dto: unknown, @Req() req): Promise<{ threadId: string }> {
    const parsed = ChatRequestSchema.safeParse(dto);
    if (!parsed.success) {
      throw new HttpException(
        { message: parsed.error.issues.map((i) => i.message).join('; ') },
        HttpStatus.BAD_REQUEST,
      );
    }
    const reqBody = parsed.data as ChatRequest;
    return this.ai.createThread({
      // Task 11.1/11.5:身份取自鉴权上下文(req.user),不信任请求体
      userId: req?.user?.id != null ? String(req.user.id) : undefined,
      message: reqBody.message,
      canvas: reqBody.canvas,
      sessionId: reqBody.sessionId,
      projectId: reqBody.projectId,
      // multi-artifact-batch:产物形态提示(Schema 层白名单校验过才到这里)
      formHint: reqBody.formHint,
    });
  }

  /** 1') Task 3 免登录试用:匿名生成流程图(不扣用户配额;快赢批次一起每日 2 次)。
   *  @Public 豁免 JWT;TrialRateLimitGuard 限 IP 5 次/10 分钟;
   *  service 内另有 trialId 日 2 次 / IP 日 6 次 / 全局日 100 三层台账防线。
   *  响应经 TransformInterceptor 包成 { code:0, data:{ threadId }, message }。
   */
  @Post('trial/chat')
  @Public()
  @UseGuards(TrialRateLimitGuard)
  @Header('Cache-Control', 'no-store')
  async trialChat(@Body() dto: unknown, @Req() req): Promise<{ threadId: string }> {
    const parsed = TrialChatRequestSchema.safeParse(dto);
    if (!parsed.success) {
      throw new HttpException(
        { message: parsed.error.issues.map((i) => i.message).join('; ') },
        HttpStatus.BAD_REQUEST,
      );
    }
    const reqBody = parsed.data as TrialChatRequest;
    const ip = req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
    return this.ai.startTrial(reqBody, ip);
  }

  /** 2) 思考流:SSE 逐 token(EventSource 不带鉴权头 → @Public 豁免,threadId 即凭证) */
  @Sse('think/:threadId')
  @Public()
  @SkipInterceptor()
  @Header('Cache-Control', 'no-store')
  think(@Param('threadId') threadId: string): Observable<MessageEvent> {
    return this.ai.subscribeThink(threadId);
  }

  /**
   * 3) 结果:未就绪返回 202 + Retry-After,就绪返回 200 完整数据;
   *    挂起(人在回路)返回 200 + status='need_confirm'(前端据此渲染确认 UI,Task 9.5)。
   *    向后兼容:旧前端只识别 done/error,need_confirm 会继续轮询直到超时,不报错。
   *    Task 3:@Public —— 免登录试用同样轮询此端点,threadId(randomUUID 不可猜测)即凭证,与 SSE think 同理;
   *    已登录用户行为完全不变(带不带 JWT 均放行,读的还是同一 threadId 的数据)。
   */
  @Get('result/:threadId')
  @Public()
  @SkipInterceptor()
  @Header('Cache-Control', 'no-store')
  async result(@Param('threadId') threadId: string, @Res() res: Response) {
    try {
      const view = this.ai.readResult(threadId);
      if (view.status === 'pending') {
        // 执行中 → 202 + Retry-After(前端轮询)
        res.status(HttpStatus.ACCEPTED).setHeader('Retry-After', '0.5').send({ status: 'pending' });
        return;
      }
      if (view.status === 'need_confirm') {
        res.status(HttpStatus.OK).send({ status: 'need_confirm', data: view.data });
        return;
      }
      if (view.status === 'error') {
        res.status(HttpStatus.OK).send({ status: 'error', message: view.message });
        return;
      }
      res.status(HttpStatus.OK).send({ status: 'done', data: view.data });
    } catch (e: any) {
      if (e instanceof NotFoundException) {
        res.status(HttpStatus.NOT_FOUND).send({ status: 'error', message: e.message });
        return;
      }
      res
        .status(HttpStatus.OK)
        .send({ status: 'error', message: e?.message ?? 'AI 执行失败' });
    }
  }

  /**
   * 4) 人在回路确认(Task 9.5):
   *    - accept:采用候选方案 → 立即写入结果,前端下一次轮询即拿到 done;
   *    - retry :带补充约束恢复执行 → 返回 pending,前端继续轮询。
   *    Task 3:@Public —— 与 result 同理,threadId 即凭证(挂起时另有 resumeToken 防伪造)。
   */
  @Post('confirm/:threadId')
  @Public()
  @SkipInterceptor()
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Param('threadId') threadId: string,
    @Body() dto: unknown,
  ): Promise<{ status: 'pending'; threadId: string }> {
    const parsed = ConfirmRequestSchema.safeParse(dto);
    if (!parsed.success) {
      throw new HttpException(
        { message: parsed.error.issues.map((i) => i.message).join('; ') },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.ai.confirmThread(threadId, parsed.data as ConfirmRequest);
  }

  /**
   * 5) 当日配额用量(商业化首发新增):响应经 TransformInterceptor 包成 { code, data, message },
   *    前端 utils/http.ts 统一解包;未登录由 JwtAuthGuard 返回 401(浮窗只出现在编辑器内,天然已登录)。
   */
  @Get('quota')
  @Header('Cache-Control', 'no-store')
  async quota(@Req() req) {
    const userId = req?.user?.id != null ? String(req.user.id) : undefined;
    return this.quotaService.getDailyUsage(userId);
  }
}
