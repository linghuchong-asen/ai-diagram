// 语图技术方案 - prompts 提示词模块
export * from './system.prompt';
export * from './generate.prompt';
export * from './modify.prompt';
export * from './reflect.prompt';
export * from './fallback.prompt';
// 多形态产物提示词(multi-artifact-batch):generate 意图按 artifactKind 分发
export * from './artifact.prompts';

// 说明:compress / suggest 两个提示词属「记忆压缩 / 追问建议」能力,
// 由记忆(memory)与上下文(context)模块按需消费,本编排链路不直接调用(详见各文件头注释)。
// 原 optimize(图优化)提示词因无任何消费方,已随孤岛清理删除(2026-10-17,经用户确认)。
