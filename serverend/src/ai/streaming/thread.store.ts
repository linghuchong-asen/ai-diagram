// 语图技术方案 - 流式输出:「思考流式 + 数据一次性」
// 文档:
//   1. POST /api/ai/chat -> { threadId }(立即返回,后台跑 LangGraph)
//   2. SSE  /api/ai/think/:threadId -> 逐 token 推送思考过程
//   3. GET  /api/ai/result/:threadId -> 202 + Retry-After 轮询,就绪返回完整数据
//   4. GET  /api/ai/result/:threadId -> 200 + status='need_confirm' 挂起态(人在回路,Task 9.5)
//   5. POST /api/ai/confirm/:threadId -> 提交确认后恢复执行
// ThreadStore 用于存放每个 thread 的执行状态与结果。
import { Injectable } from '@nestjs/common';
import { AiResult } from '../schemas/chat.schema';
import { HumanConfirmPayload } from '../reflection/rewriter';
import { AgentState } from '../agents/state';

/**
 * 线程状态:
 *  - running      :执行中(result 端点返回 202)
 *  - done         :已产出结果
 *  - error        :执行失败
 *  - need_confirm :反思修正超限,挂起等待用户确认(Task 9.5;result 端点返回 200 + 确认载荷)
 */
export type ThreadStatus = 'running' | 'done' | 'error' | 'need_confirm';

export interface ThreadRecord {
  threadId: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  result?: AiResult;
  error?: string;
  /** 挂起时下发的确认载荷(reason + issue 列表 + 候选修正方案) */
  confirmPayload?: HumanConfirmPayload;
  /** 恢复执行令牌:防止前端重复/伪造提交确认 */
  resumeToken?: string;
  /** 挂起时的状态快照:用户确认后据此恢复执行(不重跑意图识别与上下文组装的输入部分) */
  suspendedState?: Partial<AgentState>;
  /** 订阅了思考流的消费者数量(用于清理) */
  subscribers: number;
}

@Injectable()
export class ThreadStore {
  private store = new Map<string, ThreadRecord>();

  create(threadId: string): ThreadRecord {
    const now = Date.now();
    const rec: ThreadRecord = {
      threadId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      subscribers: 0,
    };
    this.store.set(threadId, rec);
    return rec;
  }

  get(threadId: string): ThreadRecord | undefined {
    return this.store.get(threadId);
  }

  setStatus(threadId: string, status: ThreadStatus, extra?: Partial<ThreadRecord>): void {
    const rec = this.store.get(threadId);
    if (!rec) return;
    rec.status = status;
    rec.updatedAt = Date.now();
    if (extra) Object.assign(rec, extra);
  }

  setResult(threadId: string, result: AiResult): void {
    const rec = this.store.get(threadId);
    if (!rec) return;
    rec.result = result;
    rec.status = 'done';
    rec.updatedAt = Date.now();
    // 结果已产出,挂起态相关字段即刻清理(避免旧载荷被重复消费)
    rec.confirmPayload = undefined;
    rec.resumeToken = undefined;
    rec.suspendedState = undefined;
  }

  setError(threadId: string, message: string): void {
    const rec = this.store.get(threadId);
    if (!rec) return;
    rec.error = message;
    rec.status = 'error';
    rec.updatedAt = Date.now();
    rec.confirmPayload = undefined;
    rec.resumeToken = undefined;
  }

  /** 置为挂起态:等待用户确认(Task 9.5) */
  setNeedConfirm(threadId: string, payload: HumanConfirmPayload, extra?: Partial<ThreadRecord>): void {
    const rec = this.store.get(threadId);
    if (!rec) return;
    rec.status = 'need_confirm';
    rec.confirmPayload = payload;
    rec.updatedAt = Date.now();
    if (extra) Object.assign(rec, extra);
  }

  /** 恢复执行:回到 running 并清掉挂起载荷(保留 suspendedState 供本次重跑使用) */
  resume(threadId: string): boolean {
    const rec = this.store.get(threadId);
    if (!rec || rec.status !== 'need_confirm') return false;
    rec.status = 'running';
    rec.updatedAt = Date.now();
    rec.confirmPayload = undefined;
    rec.resumeToken = undefined;
    rec.error = undefined;
    return true;
  }

  addSubscriber(threadId: string): void {
    const rec = this.store.get(threadId);
    if (rec) rec.subscribers += 1;
  }

  removeSubscriber(threadId: string): void {
    const rec = this.store.get(threadId);
    if (rec && rec.subscribers > 0) rec.subscribers -= 1;
  }

  delete(threadId: string): boolean {
    return this.store.delete(threadId);
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * 清理超过 ms 未更新且无人订阅的线程(由 ThreadCleanerService 定时调用,Task 9.4)。
   * @param onRemoved 每清理一条线程时的回调(供调用方联动清理该线程的派生数据,如短期记忆 checkpoint)
   * @returns 清理条数
   */
  cleanupOlderThan(ms: number, onRemoved?: (threadId: string) => void): number {
    const cutoff = Date.now() - ms;
    let removed = 0;
    for (const [id, rec] of this.store) {
      if (rec.updatedAt < cutoff && rec.subscribers === 0) {
        this.store.delete(id);
        removed += 1;
        onRemoved?.(id);
      }
    }
    return removed;
  }
}
