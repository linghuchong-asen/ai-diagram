import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { RequestLoggerMiddleware } from './core/middleware/request-logger.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectManagerModule } from './operationalModules/projectManager/project_manager.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import envConfig from '../config/env';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { EditorDocumentModule } from './operationalModules/editorDocument/editor_document.module';
import { AiModule } from './ai/ai.module';
// 语图 V1.1:免登录只读分享链接（/share/project/:id 创建撤销 + /share/view/:token 公开读取）
import { ProjectShareModule } from './operationalModules/projectShare/project_share.module';
// Task 6:按次付费解锁（/billing/unlock/:projectId 下单 + /billing/notify/xunhupay 支付回调）
import { BillingModule } from './billing/billing.module';
// Task 7:模板中心（GET /template/list 静态预置 12 个高频模板，公开端点免 JWT + 限流）
import { TemplateModule } from './operationalModules/template/template.module';
// import { ProjectSearchModule } from './operationalModules/projectSearch/project_search.module';
// Task 13.1:轻量观测模块(@Global),graph.ts 9 阶段 trace 埋点依赖其中的 TraceService
import { ObservabilityModule } from './observability/observability.module';

/* nest项目可以理解为由好多模块组成的，app.module.ts是项目的根模块 */
@Module({
  // imports的作用是引入其他模块，providers的作用是为当前模块提供服务的文件
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 在全局任何地方都可以使用ConfigService来获取配置信息
      envFilePath: [envConfig.path],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        // 统一使用 PostgreSQL 单库:关系表(user/project) + jsonb 文档(editorData) + 记忆(conversation_summaries)
        type: 'postgres',
        // entities: [PostsEntity], // 数据表实体
        autoLoadEntities: true, // 自动加载实体，不用崽崽entities数组中一个一个添加了，不过要配合ypeOrmModule.forFeature()将对应的实体注册到nestjs模块中
        host: configService.get('DB_HOST', 'localhost'), // 后面的localhost是当前没有配置环境变量时，默认值
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get('DB_USER', 'postgres'),
        password: configService.get('DB_PASSWD', '123456'),
        // Task 11.4:synchronize 受环境开关控制 —— DB_SYNCHRONIZE 显式配置优先;未配置时开发 true / 生产(NODE_ENV=production) false
        synchronize:
          String(
            configService.get('DB_SYNCHRONIZE') ??
              (String(configService.get('NODE_ENV') ?? process.env.NODE_ENV ?? '') === 'production'
                ? 'false'
                : 'true'),
          ).toLowerCase() !== 'false',
        database: configService.get('DB_DATABASE', 'flowchart_editor'),
      }),
    }),
    ServeStaticModule.forRoot({
      // 静态资源目录，项目启动后代码会被打包进dist文件夹;这里要结合multer储存位置决定
      rootPath: path.resolve(__dirname, '../../', 'uploads'),
    }),
    ProjectManagerModule,
    UserModule,
    AuthModule,
    EditorDocumentModule,
    // ProjectSearchModule:已由 ProjectManagerModule 与 EditorDocumentModule 显式 imports,
    // 恢复顶层 import 会导致 ProjectSearchModule/其依赖被重复注册,故保持注释。
    ObservabilityModule,
    AiModule,
    // 语图 V1.1:免登录只读分享链接（公开读取端点免 JWT，仅限流守卫）
    ProjectShareModule,
    // Task 6:按次付费解锁（虎皮椒通道未配置时自动降级赞助模式）
    BillingModule,
    // Task 7:模板中心（静态预置模板，公开端点仅限流守卫）
    TemplateModule
  ],
  controllers: [AppController], // 处理http请求，包括路由控制，向客户端返回响应
  providers: [AppService], // 服务提供者，处理具体的业务逻辑
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}