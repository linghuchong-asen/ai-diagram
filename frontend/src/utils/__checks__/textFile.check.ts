// 语图 Round F（utils/textFile）可执行断言脚本
// 覆盖：clipToLimit 的边界与 Unicode 安全截断；readTextFile 的白名单/大小防御与正常读取。
// 运行：cd frontend && npx tsx src/utils/__checks__/textFile.check.ts

import { clipToLimit, MAX_TEXT_FILE_BYTES, readTextFile } from '../textFile';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../pages/ai/__checks__/check-util';

/** 构造测试用 File（Node 20+ 全局有 File 构造器） */
function makeFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

// Node 环境没有 FileReader 全局（浏览器专属 API），历史版本在无 DOM 的 tsx/Node 下会
// 以未捕获 ReferenceError 崩溃。这里补一个最小等价桩：readAsText 用 File.text() 实现，
// 使 readTextFile 的白名单/大小断言在 Node 下同样可运行（浏览器内仍走原生 FileReader）。
if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  (globalThis as unknown as { FileReader: unknown }).FileReader = class FileReaderStub {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result: string | null = null;
    readAsText(file: File): void {
      void file
        .text()
        .then((text) => {
          this.result = text;
          this.onload?.();
        })
        .catch(() => this.onerror?.());
    }
  };
}

describe('clipToLimit：按上限截断', () => {
  it('未超限原样返回且 truncated=false', () => {
    const result = clipToLimit('报销流程说明', 500);
    assertEqual(result.text, '报销流程说明', '短文本应原样返回');
    assertEqual(result.truncated, false, '未截断');
  });

  it('超限截断到上限且 truncated=true', () => {
    const long = '甲'.repeat(600);
    const result = clipToLimit(long, 500);
    assertEqual(result.text.length, 500, '应恰好截断到 500');
    assertEqual(result.truncated, true, '应标记截断');
  });

  it('Unicode 安全：按码位而非 UTF-16 单元截断（emoji 不被劈成两半）', () => {
    // 😀 是 surrogate pair（2 个 UTF-16 单元）；按码位截 3 个 emoji 应完整
    const result = clipToLimit('😀😀😀😀', 3);
    assertEqual(Array.from(result.text).length, 3, '应保留 3 个完整码位');
    assertEqual(result.text, '😀😀😀', 'emoji 不应被劈开');
  });

  it('空输入与空上限的防御（limit=0 → 空 text + 截断标记按长度判断）', () => {
    assertEqual(clipToLimit('', 500).text, '', '空输入安全');
    const zero = clipToLimit('abc', 0);
    assertEqual(zero.text, '', 'limit=0 输出空串');
    assertEqual(zero.truncated, true, '有内容但 limit=0 视为已截断');
  });
});

describe('readTextFile：白名单与大小防御', () => {
  it('正常读取 .txt 文件内容', async () => {
    const content = await readTextFile(makeFile('notes.txt', '第一行\n第二行'));
    assertEqual(content, '第一行\n第二行', '应读出完整文本');
  });

  it('.md 文件允许（白名单扩展名）', async () => {
    const content = await readTextFile(makeFile('readme.md', '# 标题', 'text/markdown'));
    assertEqual(content, '# 标题', '.md 应可读');
  });

  it('非白名单扩展名（如 .exe/.docx）拒绝', async () => {
    let rejected = false;
    try {
      await readTextFile(makeFile('virus.exe', 'MZ...', 'application/octet-stream'));
    } catch (error) {
      rejected = true;
      assertTrue(String((error as Error).message).includes('只支持'), '拒绝文案应说明支持类型');
    }
    assertTrue(rejected, '.exe 应被拒绝');
  });

  it('超过 2MB 拒绝（构造超限文件）', async () => {
    // 不真造 2MB 字符串：用 size 属性超限的 File 桩（readTextFile 只读 size 判断）
    const oversized = { name: 'big.txt', type: 'text/plain', size: MAX_TEXT_FILE_BYTES + 1 } as File;
    let rejected = false;
    try {
      await readTextFile(oversized);
    } catch (error) {
      rejected = true;
      assertTrue(String((error as Error).message).includes('2MB'), '拒绝文案应说明上限');
    }
    assertTrue(rejected, '超限文件应被拒绝');
  });
});

finish('textFile');
