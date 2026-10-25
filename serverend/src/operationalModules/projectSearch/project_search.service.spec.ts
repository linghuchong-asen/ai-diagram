// Task 13.4:检索服务纯函数单测(清洗防注入 / 中英文切分 / 画布文本抽取 / LIKE 转义)
// 只测纯函数，不触达 DataSource 与数据库。
import {
  sanitizeSearchQuery,
  buildIndexTokens,
  extractEditorText,
  escapeLikePattern,
} from './project_search.service';

describe('ProjectSearchService 纯函数', () => {
  describe('sanitizeSearchQuery', () => {
    it('空值与非法类型归一为空串', () => {
      expect(sanitizeSearchQuery(null)).toBe('');
      expect(sanitizeSearchQuery(undefined)).toBe('');
      expect(sanitizeSearchQuery('')).toBe('');
      expect(sanitizeSearchQuery('   ')).toBe('');
    });

    it('中文检索词原样保留', () => {
      expect(sanitizeSearchQuery('请假审批流程')).toBe('请假审批流程');
    });

    it('剔除 tsquery 操作符，避免语法噪声', () => {
      const cleaned = sanitizeSearchQuery("请假 & (审批 | !流程) <x> ~'y'");
      expect(cleaned).not.toMatch(/[&|!():*<>~"'\\/@^%]/);
      expect(cleaned).toContain('请假');
      expect(cleaned).toContain('审批');
    });

    it('剔除控制字符(NUL/ESC/DEL 等)', () => {
      expect(sanitizeSearchQuery('请假\u0000审批\u007f')).toBe('请假 审批');
      // ESC 本身被替换为空格；ANSI 序列的可见残留不参与 SQL 拼接，仅作为普通文本
      expect(sanitizeSearchQuery('请假\u001b审批')).toBe('请假 审批');
    });

    it('连续空白折叠为单个空格并 trim', () => {
      expect(sanitizeSearchQuery('  请假\u3000\n 审批  ')).toBe('请假 审批');
    });

    it('超长输入截断到默认上限 64', () => {
      const cleaned = sanitizeSearchQuery('流'.repeat(500));
      expect(cleaned).toHaveLength(64);
    });

    it('支持自定义长度上限', () => {
      expect(sanitizeSearchQuery('abcdefg', 3)).toBe('abc');
    });

    it('数字与英文不被破坏(仅大小写保持原样)', () => {
      expect(sanitizeSearchQuery('OKR 2026 Q4')).toBe('OKR 2026 Q4');
    });

    it('非字符串入参先 String 化再清洗', () => {
      expect(sanitizeSearchQuery(123)).toBe('123');
      // 对象被 String 化后不含 tsquery 操作符，检索必然无命中，不构成注入面
      expect(sanitizeSearchQuery({})).toBe('[object Object]');
    });
  });

  describe('buildIndexTokens', () => {
    it('空输入返回空串', () => {
      expect(buildIndexTokens('')).toBe('');
      expect(buildIndexTokens(undefined as any)).toBe('');
    });

    it('英文数字按整词保留并小写', () => {
      const tokens = buildIndexTokens('Flow Editor v2').split(' ');
      expect(tokens).toEqual(['flow', 'editor', 'v2']);
    });

    it('下划线标识符视为整词', () => {
      expect(buildIndexTokens('project_name').split(' ')).toEqual(['project_name']);
    });

    it('中文按「单字 + 相邻二字」切分', () => {
      // 请假 → 请, 请假, 假
      expect(buildIndexTokens('请假').split(' ')).toEqual(['请', '请假', '假']);
    });

    it('三字中文产生单字与相邻二字组合', () => {
      expect(buildIndexTokens('审批流').split(' ')).toEqual([
        '审',
        '审批',
        '批',
        '批流',
        '流',
      ]);
    });

    it('中英混排两侧 token 都产出', () => {
      const tokens = buildIndexTokens('请假 leave 审批').split(' ');
      expect(tokens).toContain('leave');
      expect(tokens).toContain('请假');
      expect(tokens).toContain('审批');
    });

    it('超长文本截断后再切分(避免 tsvector 溢出)', () => {
      const tokens = buildIndexTokens('流'.repeat(5000), 100).split(' ');
      // 100 个汉字 → 100 单字 + 99 二字
      expect(tokens).toHaveLength(199);
    });

    it('标点被切分器丢弃(不参与建索引)', () => {
      const tokens = buildIndexTokens('请假，审批！').split(' ');
      expect(tokens).not.toContain('，');
      expect(tokens).not.toContain('！');
      expect(tokens).toContain('请假');
    });

    it('检索词与索引 token 可对齐:buildIndexTokens(检索词) 的 token 是索引 token 子集', () => {
      const docTokens = buildIndexTokens('员工请假审批流程').split(' ');
      const queryTokens = buildIndexTokens('请假审批').split(' ');
      for (const t of queryTokens) {
        expect(docTokens).toContain(t);
      }
    });
  });

  describe('extractEditorText', () => {
    it('空数据返回空串', () => {
      expect(extractEditorText(null)).toBe('');
      expect(extractEditorText(undefined)).toBe('');
      expect(extractEditorText('')).toBe('');
    });

    it('抽取 X6 画布节点 label 与备注文本', () => {
      const editorData = {
        nodes: [
          { id: 'node-1', shape: 'rect', label: '提交请假申请', data: { remark: '员工发起' } },
          { id: 'node-2', shape: 'rect', label: '主管审批' },
        ],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
      };
      const text = extractEditorText(editorData);
      expect(text).toContain('提交请假申请');
      expect(text).toContain('员工发起');
      expect(text).toContain('主管审批');
    });

    it('过滤 id / shape / 坐标等噪声字段', () => {
      const text = extractEditorText({
        nodes: [{ id: 'node-uuid-123', shape: 'rect', x: 10, y: 20, width: 100, label: '审批' }],
      });
      expect(text).toBe('审批');
      expect(text).not.toContain('node-uuid-123');
      expect(text).not.toContain('rect');
    });

    it('跳过边上的 source/target(会污染检索词)', () => {
      const text = extractEditorText({
        edges: [{ id: 'e1', source: 'n1', target: 'n2', label: '通过' }],
      });
      expect(text).toBe('通过');
    });

    it('超长字符串(>200 字符)不作为索引文本', () => {
      const text = extractEditorText({ nodes: [{ desc: 'a'.repeat(201), label: '正常标签' }] });
      expect(text).toBe('正常标签');
    });

    it('总长度封顶 4000，超出部分不再追加', () => {
      const bigNodes = Array.from({ length: 200 }, (_, i) => ({ label: '节点标签'.repeat(4) + i }));
      const text = extractEditorText({ nodes: bigNodes });
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(text.length).toBeGreaterThan(0);
    });

    it('嵌套数组与对象都能遍历到', () => {
      const text = extractEditorText({
        cells: [{ data: { tags: ['考勤', '人事'] } }, { meta: { owner: '张三' } }],
      });
      expect(text).toContain('考勤');
      expect(text).toContain('人事');
      expect(text).toContain('张三');
    });

    it('非字符串标量被忽略', () => {
      expect(extractEditorText({ count: 3, flag: true, ratio: 0.5 })).toBe('');
    });
  });

  describe('escapeLikePattern', () => {
    it('转义 % _ \\ 三个 ILIKE 特殊字符', () => {
      expect(escapeLikePattern('50%')).toBe('50\\%');
      expect(escapeLikePattern('a_b')).toBe('a\\_b');
      expect(escapeLikePattern('c:\\path')).toBe('c:\\\\path');
    });

    it('普通中英文不受影响', () => {
      expect(escapeLikePattern('请假审批')).toBe('请假审批');
    });

    it('多特殊字符同时转义', () => {
      expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
    });
  });
});
