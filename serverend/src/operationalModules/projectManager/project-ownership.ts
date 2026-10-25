// 语图技术方案 - 项目归属校验(Task 11.2)
// 规则(security.md 数据隔离):当前用户 ≠ 项目归属 → 403;
// 文案统一为「无权访问该项目」,不区分「不存在/无权」,避免泄露资源存在性。
// 说明:项目归属取 project.userId(创建人);历史数据该列为 NULL,视为未归属,不拦截(兼容存量)。
import { HttpException, HttpStatus } from '@nestjs/common';

export const PROJECT_FORBIDDEN_MESSAGE = '无权访问该项目';

/** 归属校验:owner 存在且与当前用户不一致 → 403 */
export function ensureProjectOwner(
  ownerId: string | null | undefined,
  userId: string | null | undefined,
): void {
  if (ownerId && userId && String(ownerId) !== String(userId)) {
    throw new HttpException(PROJECT_FORBIDDEN_MESSAGE, HttpStatus.FORBIDDEN);
  }
}
