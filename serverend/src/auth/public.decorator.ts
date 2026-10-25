// 语图技术方案 - @Public() 装饰器(Task 11.1)
// 用途:标记「不需要 JWT 鉴权」的路由。JwtAuthGuard 读取该元数据后直接放行。
// 典型场景:SSE 端点(GET /ai/think/:threadId)——浏览器 EventSource 无法携带
// Authorization 头,threadId 本身作为一次性凭证(randomUUID,不可枚举)。
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
