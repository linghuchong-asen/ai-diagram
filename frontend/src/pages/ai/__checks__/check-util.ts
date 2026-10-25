// 语图技术方案 - 前端 AI 模块「可执行断言脚本」公共工具
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 1.4 / 2.4 / 3.5（单元测试）
// 说明：项目未安装任何测试框架（无 jest/vitest），且约束「不新增依赖」，
//      故实现最小断言器：describe/it 收集结果 → console 输出 → 有失败则抛错（tsx 退出码非 0）。
// 本文件位于 src 内，会被 tsc 检查，因此严格满足 strict 模式（不使用 @types/node 的任何 API）。

interface Failure {
  suite: string;
  name: string;
  message: string;
}

let currentSuite = '';
let passed = 0;
const failures: Failure[] = [];

function write(line: string): void {
  console.log(line);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 测试套件分组标题 */
export function describe(title: string, body: () => void): void {
  currentSuite = title;
  write(`\n== ${title} ==`);
  body();
}

/** 单个用例：抛错即失败 */
export function it(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    write(`  [PASS] ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : stringify(error);
    failures.push({ suite: currentSuite, name, message });
    write(`  [FAIL] ${name}`);
    write(`         -> ${message}`);
  }
}

/** 输出汇总；存在失败用例时抛错，使脚本退出码非 0 */
export function finish(label: string): void {
  const total = passed + failures.length;
  write(`\n---- ${label} 汇总：${passed}/${total} 通过，${failures.length} 失败 ----`);
  if (failures.length > 0) {
    throw new Error(`${label}: ${failures.length} 个断言失败`);
  }
}

// ---------------------------------------------------------------------------
// 断言原语
// ---------------------------------------------------------------------------

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertFalse(condition: boolean, message: string): void {
  if (condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}（期望 ${stringify(expected)}，实际 ${stringify(actual)}）`);
  }
}

export function assertNotEqual<T>(actual: T, unexpected: T, message: string): void {
  if (actual === unexpected) {
    throw new Error(`${message}（不应等于 ${stringify(unexpected)}）`);
  }
}

export function assertClose(actual: number, expected: number, message: string, eps = 1e-9): void {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${message}（期望 ≈${expected}，实际 ${actual}）`);
  }
}

/** 深比较（基于 JSON 序列化，足够覆盖本模块的纯数据结构） */
export function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = stringify(actual);
  const b = stringify(expected);
  if (a !== b) {
    throw new Error(`${message}\n         期望: ${b}\n         实际: ${a}`);
  }
}

export function assertThrows(body: () => void, message: string): void {
  let thrown = false;
  try {
    body();
  } catch {
    thrown = true;
  }
  if (!thrown) throw new Error(message);
}

/** 数组元素断言辅助：安全取下标，缺失即失败 */
export function at<T>(list: readonly T[], index: number, message: string): T {
  const value = list[index];
  if (value === undefined) throw new Error(`${message}（下标 ${index} 越界，长度 ${list.length}）`);
  return value;
}
