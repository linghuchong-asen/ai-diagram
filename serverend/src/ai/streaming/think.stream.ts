// 语图技术方案 - 思考流式推送
// SSE 逐 token 推送思考过程;数据(FlowDraft/Operations)走 result 一次性拉取。
// 生命周期(Task 9.4):一次线程执行无论「成功 / 失败 / 中断(转人在回路)」,
// 编排层都必须在 finally 中调用 end(threadId),以便:
//   1) 向订阅者推送终态事件(done/error),前端可立即停止等待;
//   2) 完成 Observable,释放 SSE 连接;
//   3) 清理通道,避免 Map 长期驻留(内存泄漏)。
import { Injectable } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { ThinkSseEvent } from '../schemas/chat.schema';

/** 单个订阅者:token 推送 + 终态回调 */
export interface ThinkListener {
  /** 思考 token 增量 */
  onToken: (token: string) => void;
  /** 流结束:done = 正常收尾;error = 异常收尾(均会完成订阅) */
  onFinish?: (kind: 'done' | 'error', payload: { threadId: string; message?: string }) => void;
}

export interface ThinkStreamHubLike {
  subscribe(threadId: string, listener: ThinkListener): () => void;
  publish(threadId: string, token: string): void;
  end(threadId: string): void;
  error(threadId: string, message: string): void;
}

/**
 * 思考流通道:Graph 执行过程中产生的 CoT token 通过 publish 推送给该 thread 的订阅者。
 * 每个 SSE 连接调用 subscribe 注册监听器,返回退订函数(客户端断开时调用)。
 */
@Injectable()
export class ThinkStreamHub implements ThinkStreamHubLike {
  private channels = new Map<string, Set<ThinkListener>>();

  subscribe(threadId: string, listener: ThinkListener): () => void {
    if (!this.channels.has(threadId)) {
      this.channels.set(threadId, new Set());
    }
    this.channels.get(threadId)!.add(listener);
    return () => {
      const listeners = this.channels.get(threadId);
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.channels.delete(threadId);
      }
    };
  }

  publish(threadId: string, token: string): void {
    const listeners = this.channels.get(threadId);
    if (!listeners) return;
    for (const listener of listeners) listener.onToken(token);
  }

  /**
   * 正常/中断收尾:推送 done 终态并完成订阅,然后清理通道。
   * 幂等:通道不存在时直接返回,重复调用无副作用。
   */
  end(threadId: string): void {
    const listeners = this.channels.get(threadId);
    if (!listeners) return;
    for (const listener of listeners) {
      listener.onFinish?.('done', { threadId });
    }
    this.channels.delete(threadId);
  }

  /** 异常收尾:保留原有「[错误] xxx」token 兼容推送,再推 error 终态并完成订阅 */
  error(threadId: string, message: string): void {
    const listeners = this.channels.get(threadId);
    if (!listeners) return;
    for (const listener of listeners) {
      listener.onToken(`[错误] ${message}`);
      listener.onFinish?.('error', { threadId, message });
    }
    this.channels.delete(threadId);
  }

  /** 将 token 转换为 NestJS SSE 事件流(事件类型见 ThinkSseEvent) */
  toObservable(threadId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber: Subscriber<MessageEvent>) => {
      const listener: ThinkListener = {
        onToken: (token: string) => {
          const evt: ThinkSseEvent = { type: 'thinking', data: { token } };
          subscriber.next({ type: evt.type, data: JSON.stringify(evt.data) });
        },
        onFinish: (kind, payload) => {
          const evt: ThinkSseEvent =
            kind === 'done'
              ? { type: 'done', data: { threadId: payload.threadId } }
              : { type: 'error', data: { message: payload.message ?? 'AI 执行失败' } };
          subscriber.next({ type: evt.type, data: JSON.stringify(evt.data) });
          subscriber.complete();
        },
      };
      const unsubscribe = this.subscribe(threadId, listener);
      return () => unsubscribe();
    });
  }
}
