// 语图技术方案 - AI 模块装配
// 模块划分:schemas / intent / context / memory / reflection / tools / agents / streaming / adapters / prompts / quota / security
// Task 10 收尾:记忆体系全量接线(PG 存储 / Embedding / Reranker / 遗忘曲线定时器)
// Task 11:鉴权(AuthModule)+ 配额(QuotaService)
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { FlowStateGraph } from './agents/graph';
import { IntentRecognizer } from './intent/intent.recognizer';
import { IntentLlmClassifier } from './intent/intent.llm-classifier';
// multi-artifact-batch:形式路由器(generate 意图内的产物形态二级路由)
import { FormRouter } from './form/form.router';
import { ContextBuilder } from './context/context.builder';
import { ReflectionEvaluator } from './reflection/evaluator';
import { Rewriter } from './reflection/rewriter';
import { ToolRegistry } from './tools/tool.registry';
import { TemplateMatcher } from './tools/template-matcher';
import { ValidatorTool } from './tools/validator.tool';
import { ToolContextStore } from './tools/tool-context.store';
import { ToolExecutor } from './tools/tool-executor';
import { LlmFactory } from './adapters/llm.factory';
import { CheckpointService } from './memory/short-term/checkpoint.memory';
import { LongTermMemoryService } from './memory/long-term/long-term.store';
import { UserProfileService } from './memory/profile/user.profile';
import { ForgettingCurveService } from './memory/forget/forgetting.curve';
import { ForgettingScheduler } from './memory/forget/forget.scheduler';
import { RollingSummaryService } from './memory/short-term/rolling-summary.service';
import { SessionEntitySlotService } from './memory/entity-slot';
import { EmbeddingProviderFactory, EMBEDDING_PROVIDER } from './memory/embedding.provider';
import { LlmMemoryReranker } from './memory/long-term/reranker';
import { MemoryStoreWiringService } from './memory/memory.wiring';
import { AiCheckpointEntity } from './memory/short-term/checkpoint.entity';
import { LongTermMemoryEntity } from './memory/long-term/long-term.entity';
import { AiDailyUsageEntity } from './quota/ai-daily-usage.entity';
// 商业化闭环批次:QuotaService 读 user.vip_expire_time 判定会员额度,注册 UserEntity 仓库
import { UserEntity } from '../user/entities/user.entity';
// 留存与裂变加强批次:每日签到（连签 7 天整数倍送会员天数,经 BillingModule 的 grantVipDays）
import { DailyCheckinEntity } from './checkin/daily-checkin.entity';
import { CheckinService } from './checkin/checkin.service';
import { CheckinController } from './checkin/checkin.controller';
import { BillingModule } from '../billing/billing.module';
import { QuotaService } from './quota/quota.service';
import { AuthModule } from '../auth/auth.module';
import { ThreadStore } from './streaming/thread.store';
import { ThinkStreamHub } from './streaming/think.stream';
import { ThreadCleanerService } from './streaming/thread-cleaner.service';
import { SummaryMemoryModule } from './memory/summary/summary.memory.module';

@Module({
  // SummaryMemoryModule 将 ConversationSummary 实体注册到主 PostgreSQL 连接(原独立 PG 连接已并入)
  // AuthModule:Task 11.1 —— AiController 的 JwtAuthGuard 依赖其中的 JwtStrategy/令牌态
  // TypeOrmModule.forFeature:记忆(Checkpoint/长期记忆)与配额表注册到主连接(autoLoadEntities)
  imports: [
    ConfigModule,
    SummaryMemoryModule,
    AuthModule,
    // 留存与裂变加强批次:签到连签奖励经 BillingModule 的 grantVipDays 发放（无循环依赖）
    BillingModule,
    TypeOrmModule.forFeature([
      AiCheckpointEntity,
      LongTermMemoryEntity,
      AiDailyUsageEntity,
      UserEntity,
      DailyCheckinEntity,
    ]),
  ],
  controllers: [AiController, CheckinController],
  providers: [
    AiService,
    // 留存与裂变加强批次:每日签到
    CheckinService,
    // agents
    FlowStateGraph,
    // intent
    IntentRecognizer,
    IntentLlmClassifier,
    // multi-artifact-batch:形式路由
    FormRouter,
    // context
    ContextBuilder,
    // reflection
    ReflectionEvaluator,
    Rewriter,
    // tools
    TemplateMatcher,
    ValidatorTool,
    ToolContextStore,
    ToolRegistry,
    ToolExecutor,
    // adapters
    LlmFactory,
    // memory(Task 10)
    CheckpointService,
    LongTermMemoryService,
    RollingSummaryService,
    SessionEntitySlotService,
    UserProfileService,
    ForgettingCurveService,
    // Task 10.3:遗忘曲线定时器(onModuleInit 挂载,启动 1 分钟首扫 + 每 7 天扫描,unref 不阻塞退出)
    ForgettingScheduler,
    // Task 10.2:Embedding Provider(默认走 LlmFactory 密钥的 OpenAI 兼容接口,不可用自动降级)
    EmbeddingProviderFactory,
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (factory: EmbeddingProviderFactory) => factory.create(),
      inject: [EmbeddingProviderFactory],
    },
    // Task 10.2:Reranker(LLM listwise 重排,LLM 不可用时退化 RRF 序)
    LlmMemoryReranker,
    // Task 10 收尾:启动时把 PG 存储/Embedding/Reranker 接线到记忆服务(CHECKPOINT_STORE/LONG_TERM_STORE 开关)
    MemoryStoreWiringService,
    // Task 11.5:用户级每日配额 + 会话级软上限
    QuotaService,
    // streaming
    ThreadStore,
    ThinkStreamHub,
    ThreadCleanerService,
  ],
  // Task 2:QuotaService 补充导出 —— ProjectShareModule(分享获赠 grantShareBonus)需要注入
  exports: [AiService, QuotaService],
})
export class AiModule {}
