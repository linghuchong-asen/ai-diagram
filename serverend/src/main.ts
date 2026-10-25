import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './core/filter/http-exception/http_exception.filter';
import { TransformInterceptor } from './core/interceptor/transform/transform.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { customLogger } from './utils/log/logger.service';

async function bootstrap() {
  // ========== 用自定义 Logger 替换 NestJS 默认 Logger ==========
  const app = await NestFactory.create(AppModule, {
    logger: customLogger,
  });

  // 注册全局错误的过滤器
  app.useGlobalFilters(new HttpExceptionFilter());
  // 注册全局拦截器
  app.useGlobalInterceptors(new TransformInterceptor(new Reflector()));
  // 注册全局管道
  app.useGlobalPipes(new ValidationPipe());

  // Task 11.4:CORS 白名单(security.md:拒绝通配符 *)。
  // CORS_ORIGINS 逗号分隔;未配置时仅放行本地开发端口(5173/3000)。
  const defaultAllowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length ? configuredOrigins : defaultAllowedOrigins;
  app.enableCors({
    // 函数式 origin:白名单命中才回显 Allow-Origin;非浏览器请求(无 Origin 头)放行
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true, // 如果需要发送 cookies 或认证头，设置为 true
  });

  // process是nodejs的全局变量
  await app.listen(process.env.PORT ?? 3001);
  customLogger.log(`🚀 服务启动成功，监听端口: ${process.env.PORT ?? 3001}`, 'Bootstrap');
}
// process 级兜底:漏网的异步异常记入日志;uncaughtException 按受控退出处理,避免未知状态继续服务
process.on('unhandledRejection', (reason: unknown) => {
  customLogger.error(
    `未处理的 Promise 拒绝: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    undefined,
    'Process',
  );
});
process.on('uncaughtException', (err: Error) => {
  customLogger.error(`未捕获异常,进程将退出: ${err?.stack ?? err?.message}`, err?.stack, 'Process');
  // 给日志写入留出时间后受控退出
  setTimeout(() => process.exit(1), 100).unref?.();
});

bootstrap().catch((err) => {
  customLogger.error(`服务启动失败: ${err?.stack ?? err?.message ?? err}`, err?.stack, 'Bootstrap');
  process.exit(1);
});
