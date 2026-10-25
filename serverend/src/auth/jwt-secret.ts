// 语图技术方案 - JWT 密钥强制配置(Task 11.4 配置加固)
// 规则:JWT_SECRET 必须通过环境变量注入,历史硬编码默认密钥(secret123456)一律禁用;
//       缺失/仍为历史默认值时启动即报错,并打印配置指引(security.md / backend/deploy.md:
//       敏感配置通过 .env 或密钥管理服务注入,不进版本控制)。
import { ConfigService } from '@nestjs/config';

/** 历史版本硬编码在代码里的默认密钥,禁止继续使用 */
const LEGACY_DEFAULT_SECRETS = new Set(['secret123456']);

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || LEGACY_DEFAULT_SECRETS.has(secret)) {
    throw new Error(
      '[配置缺失/非法] JWT_SECRET 未配置或仍在使用历史默认密钥。' +
        '请在 .env(开发)或 .env.prod(生产)中设置强随机密钥,例如: `openssl rand -hex 32` 的输出。' +
        '该项不再提供代码内兜底,以避免伪造令牌风险。',
    );
  }
  return secret;
}
