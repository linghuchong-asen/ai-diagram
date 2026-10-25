import { LoggerService as NestLoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 自定义日志服务
 * - 支持 log / error / warn / debug / verbose 五个级别
 * - 日志按日期切分（每天一个文件）
 * - 同时输出到控制台和文件
 * - 实现 NestJS 的 LoggerService 接口，可以在 main.ts 中替换默认 Logger
 */
class CustomLoggerService implements NestLoggerService {
  // 日志文件根目录（会打包到 dist 下）
  private logDir = path.join(__dirname, '..', '..', '..', 'logs');
  /** 已确认存在的日志目录缓存（避免每条日志都做 existsSync 系统调用） */
  private ensuredDirs = new Set<string>();

  /** 是否为生产环境，生产环境关闭 debug/verbose 输出 */
  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * 获取当天的日志文件路径，例如 logs/app-2025-07-05.log
   */
  private getLogFilePath(type: 'info' | 'error'): string {
    const today = new Date().toISOString().split('T')[0]; // "2025-07-05"
    const dir = path.join(this.logDir, today);
    // 确保目录存在（进程生命周期内每个目录只检查一次）
    if (!this.ensuredDirs.has(dir)) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.ensuredDirs.add(dir);
    }
    return path.join(dir, `${type}.log`);
  }

  /**
   * 统一格式化日志条目
   */
  private formatMessage(
    level: string,
    message: string,
    context?: string,
    trace?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const ctx = context || 'Application';
    let formatted = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${ctx}] ${message}`;
    if (trace) {
      formatted += `\n  Stack: ${trace}`;
    }
    return formatted;
  }

  /**
   * 统一写入逻辑：同时输出到控制台和文件
   */
  private write(level: string, fileType: 'info' | 'error', formatted: string) {
    // 1. 输出到控制台
    // NOTE:必须直接使用 console.*，不可经 `new Logger()` 实例输出——
    //       NestFactory.create({ logger: customLogger }) 会把 customLogger 注册为全局静态
    //       Logger(overrideLogger)；此时 write() 内部再 new Logger() 会经过
    //       Logger.localInstance 被路由回 customLogger 本身，形成无限自递归直至
    //       栈溢出（RangeError → 进程崩溃）。console.* 输出内容与实例输出完全等价且无此风险。
    const consoleFn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(formatted);

    // 2. 写入文件
    const filePath = this.getLogFilePath(fileType);
    fs.appendFile(filePath, formatted + '\n', (err) => {
      if (err) {
        // 兜底：写入文件失败时直接输出到控制台（同样不可经 Logger 静态调用，避免递归回环）
        console.error(`自定义日志写入文件失败: ${filePath}`, err?.stack);
      }
    });
  }

  // ========== 五个日志级别 ==========

  log(message: any, context?: string): void {
    const formatted = this.formatMessage('log', String(message), context);
    this.write('log', 'info', formatted);
  }

  error(message: any, trace?: string, context?: string): void {
    const formatted = this.formatMessage('error', String(message), context, trace);
    this.write('error', 'error', formatted);
  }

  warn(message: any, context?: string): void {
    const formatted = this.formatMessage('warn', String(message), context);
    this.write('warn', 'info', formatted);
  }

  debug(message: any, context?: string): void {
    if (this.isProduction) return;
    const formatted = this.formatMessage('debug', String(message), context);
    this.write('debug', 'info', formatted);
  }

  verbose(message: any, context?: string): void {
    if (this.isProduction) return;
    const formatted = this.formatMessage('verbose', String(message), context);
    this.write('verbose', 'info', formatted);
  }
}

// 导出单例
export const customLogger = new CustomLoggerService();
export default customLogger;
