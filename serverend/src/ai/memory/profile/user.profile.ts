// 语图技术方案 - 用户画像(独立命名空间 JSON,会话结束异步更新)
// 命名空间隔离(Task 10.6 / security.md):用户画像按 user_id 隔离,读写均校验;
//   禁止用 sessionId 冒充 userId(否则画像会跨用户串号)。
import { Injectable, Logger } from '@nestjs/common';

/** 用户画像命名空间校验:userId 必须非空且不能是 sessionId(形如 `user:project`) */
export function assertUserNamespace(userId: string | undefined | null, op: string): void {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) {
    throw new Error(`用户画像${op}缺少命名空间:userId 不能为空(画像按 user_id 隔离)`);
  }
  if (id.includes(':')) {
    throw new Error(
      `用户画像${op}命名空间非法:userId="${id}" 疑似 sessionId,画像必须按 user_id 隔离`,
    );
  }
}

export interface UserProfile {
  userId: string;
  data: Record<string, unknown>; // 画像 JSON
  updatedAt: number;
}

export interface ProfileStore {
  get(userId: string): Promise<UserProfile | null>;
  set(userId: string, data: Record<string, unknown>): Promise<void>;
}

export class InMemoryProfileStore implements ProfileStore {
  private store = new Map<string, UserProfile>();
  async get(userId: string) {
    assertUserNamespace(userId, '读取');
    return this.store.get(userId) ?? null;
  }
  async set(userId: string, data: Record<string, unknown>) {
    assertUserNamespace(userId, '写入');
    this.store.set(userId, { userId, data, updatedAt: Date.now() });
  }
}

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);
  private store: ProfileStore = new InMemoryProfileStore();

  setStore(store: ProfileStore) {
    this.store = store;
  }

  async get(userId: string) {
    assertUserNamespace(userId, '读取');
    return this.store.get(userId);
  }

  async update(userId: string, data: Record<string, unknown>) {
    assertUserNamespace(userId, '写入');
    const prev = (await this.store.get(userId))?.data ?? {};
    await this.store.set(userId, { ...prev, ...data });
  }

  /** 会话结束异步更新画像:从对话中提取用户特征(领域/偏好/复杂度) */
  async ingestFromConversation(userId: string, messages: Array<{ role: string; content: string }>) {
    assertUserNamespace(userId, '写入');
    // 简易特征提取:统计领域关键词频次,供画像使用
    const text = messages.map((m) => m.content).join(' ');
    const domains = ['请假', '审批', '报销', '招聘', '开发', '部署', '注册', '登录', '下单', '退款', '测试', '发布'];
    const found = domains.filter((d) => text.includes(d));
    const prev = (await this.store.get(userId))?.data ?? {};
    const prevDomains: string[] = (prev.domains as string[]) ?? [];
    await this.update(userId, {
      domains: Array.from(new Set([...prevDomains, ...found])),
      updatedBy: 'session-end',
    });
  }
}
