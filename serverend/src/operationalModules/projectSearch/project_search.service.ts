/*
 * @Description: 项目全文检索服务
 * 方案：PostgreSQL 原生 tsvector + GIN 索引(独立索引表 search_index)，不引入 ES 等外部基础设施。
 * 中文处理：PG 内置 parser 会把连续中文当成一个词，无法子串召回；
 *          因此索引与查询两侧都在应用层做「单字 + 相邻二字」切分，再用 plainto_tsquery 检索，
 *          并保留 ILIKE 兜底，保证子串一定能搜到。
 * 安全：所有 SQL 均使用 $n 参数化绑定，用户输入不参与 SQL 拼接；sanitizeSearchQuery 另做操作符与控制字符清洗、长度截断。
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SEARCH_INDEX_TABLE,
  SEARCH_VECTOR_INDEX_NAME,
} from './entities/search_index.entity';

const logger = new Logger('ProjectSearchService');

/* PG 全文检索统一使用 simple 配置：不做词干化与停用词，配合应用层中文切分即可 */
const TS_CONFIG = 'simple';
/* 参与建索引的文本长度上限，避免超大画布把 tsvector 撑爆(tsvector 上限 1MB) */
const MAX_INDEX_TEXT_LEN = 4000;
/* 检索词最大长度 */
const MAX_QUERY_LEN = 64;
/* 单页最大条数 */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/* 画布 JSON 中无检索价值的字段(坐标、id、图形类型等) */
const IGNORED_EDITOR_KEYS = new Set([
  'id',
  'shape',
  'x',
  'y',
  'width',
  'height',
  'source',
  'target',
  'points',
  'zIndex',
  'angle',
  'visible',
  'parent',
  'children',
  'ports',
  'size',
  'position',
]);

export interface SearchHit {
  projectId: string;
  projectName: string;
  projectDesc: string;
  contentSnippet: string;
  updateTime: string | null;
  rank: number;
}

export interface SearchResult {
  list: SearchHit[];
  total: number;
  query: string;
}

/**
 * 清洗用户检索词：去除 tsquery 操作符、控制字符与多余空白，并截断长度。
 * 即使不清洗，参数化的 plainto_tsquery 也不存在 SQL 注入风险，这里主要防止超长输入与语法噪声。
 */
export function sanitizeSearchQuery(
  raw: unknown,
  maxLen = MAX_QUERY_LEN,
): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // 控制字符
    .replace(/[&|!():*<>~"'\\/@^%]/g, ' ') // tsquery 操作符与路径类符号
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * 把文本切成适合 PG simple 分词器的 token 串：
 * 英文数字按整词保留，中文按「单字 + 相邻二字」切分，全部以空格分隔。
 */
export function buildIndexTokens(text: string, maxLen = MAX_INDEX_TEXT_LEN) {
  if (!text) return '';
  const normalized = String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  const tokens: string[] = [];

  const latinWords = normalized.match(/[A-Za-z0-9_]+/g);
  if (latinWords) {
    for (const word of latinWords) tokens.push(word.toLowerCase());
  }

  const cjkRuns = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      const chars = Array.from(run);
      for (let i = 0; i < chars.length; i++) {
        tokens.push(chars[i]);
        if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return tokens.join(' ');
}

/** 从 antv X6 画布数据中抽取可读文本(节点 label、备注等)，过滤坐标与图形类型等噪声字段 */
export function extractEditorText(editorData: unknown): string {
  const out: string[] = [];
  let length = 0;
  const walk = (node: any, key: string) => {
    if (node === null || node === undefined || length >= MAX_INDEX_TEXT_LEN) {
      return;
    }
    if (typeof node === 'string') {
      const value = node.trim();
      if (!value || value.length > 200 || IGNORED_EDITOR_KEYS.has(key)) return;
      out.push(value);
      length += value.length;
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    for (const childKey of Object.keys(node)) {
      if (IGNORED_EDITOR_KEYS.has(childKey)) continue;
      walk((node as any)[childKey], childKey);
    }
  };
  walk(editorData, 'root');
  return out.join(' ');
}

/** ILIKE 模式串转义(% _ \) */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

@Injectable()
export class ProjectSearchService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * 模块启动时确保 GIN 索引存在。
   * TypeORM 的 @Index 装饰器不支持声明 USING GIN，这里用幂等 SQL 补齐(synchronize 只负责建表建列)。
   */
  async ensureGinIndex(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS "${SEARCH_VECTOR_INDEX_NAME}" ON "${SEARCH_INDEX_TABLE}" USING GIN (search_vector)`,
      );
    } catch (err) {
      logger.warn(`创建 GIN 索引失败，检索将退化为顺序扫描: ${err}`);
    }
  }

  /**
   * 写入/更新索引行。只更新传入的字段，未传入的字段保留原值，
   * 使「创建项目」与「保存画布」两个写入点互不覆盖。
   */
  async upsertIndex(
    projectId: string,
    patch: {
      projectName?: string;
      projectDesc?: string;
      contentText?: string;
    },
  ): Promise<void> {
    if (!projectId) return;
    try {
      const rows: Array<{
        project_name: string;
        project_desc: string | null;
        content_text: string | null;
      }> = await this.dataSource.query(
        `SELECT project_name, project_desc, content_text FROM "${SEARCH_INDEX_TABLE}" WHERE project_id = $1`,
        [String(projectId)],
      );
      const existing = rows && rows[0];
      const projectName = (
        patch.projectName ?? existing?.project_name ??
        ''
      ).toString();
      const projectDesc = (patch.projectDesc ?? existing?.project_desc ?? '')
        .toString();
      const contentText = (patch.contentText ?? existing?.content_text ?? '')
        .toString();

      const tokens = buildIndexTokens(
        [projectName, projectName, projectDesc, contentText].join(' '),
      );

      await this.dataSource.query(
        `INSERT INTO "${SEARCH_INDEX_TABLE}"
           (project_id, project_name, project_desc, content_text, search_vector, update_time)
         VALUES ($1, $2, $3, $4, to_tsvector('${TS_CONFIG}', $5), now())
         ON CONFLICT (project_id) DO UPDATE SET
           project_name = EXCLUDED.project_name,
           project_desc = EXCLUDED.project_desc,
           content_text = EXCLUDED.content_text,
           search_vector = EXCLUDED.search_vector,
           update_time = now()`,
        [
          String(projectId),
          projectName.slice(0, 255),
          projectDesc,
          contentText.slice(0, MAX_INDEX_TEXT_LEN),
          tokens,
        ],
      );
    } catch (err) {
      /* 索引属于派生数据，写入失败不能阻断项目创建/文档保存主流程 */
      logger.warn(`写入检索索引失败 projectId=${projectId}: ${err}`);
    }
  }

  /** 项目创建/更新后同步索引 */
  async indexProject(project: {
    id?: string | number;
    project_name?: string;
    project_desc?: string;
  }): Promise<void> {
    if (!project || project.id === undefined || project.id === null) return;
    await this.upsertIndex(String(project.id), {
      projectName: project.project_name,
      projectDesc: project.project_desc,
    });
  }

  /** 编辑器文档保存后同步画布文本索引 */
  async indexEditorDocument(document: {
    projectId?: string;
    projectName?: string;
    editorData?: any;
  }): Promise<void> {
    if (!document || !document.projectId) return;
    await this.upsertIndex(String(document.projectId), {
      projectName: document.projectName,
      contentText: extractEditorText(document.editorData),
    });
  }

  /** 项目删除后清理索引；删除失败不影响主事务(提交后调用) */
  async removeIndex(projectIds: Array<string | number>): Promise<void> {
    const ids = (projectIds || []).filter(
      (id) => id !== undefined && id !== null && id !== '',
    ).map((id) => String(id));
    if (!ids.length) return;
    try {
      await this.dataSource.query(
        `DELETE FROM "${SEARCH_INDEX_TABLE}" WHERE project_id = ANY($1::varchar[])`,
        [ids],
      );
    } catch (err) {
      logger.warn(`清理检索索引失败 projectIds=${ids.join(',')}: ${err}`);
    }
  }

  /** 全量回填：把 project 与 editor_document 现有数据重建到索引表(存量数据初始化用) */
  async rebuildAll(): Promise<{ indexed: number }> {
    await this.ensureGinIndex();
    const projects: Array<{
      id: string;
      project_name: string;
      project_desc: string | null;
    }> = await this.dataSource.query(
      'SELECT id, project_name, project_desc FROM project',
    );
    const documents: Array<{
      projectId: string;
      projectName: string;
      editorData: any;
    }> = await this.dataSource.query(
      /* editor_document 实体未显式指定列名，TypeORM 默认按属性名建列(camelCase)，需加引号 */
      'SELECT "projectId", "projectName", "editorData" FROM editor_document',
    );

    const contentByProject = new Map<string, string>();
    for (const doc of documents || []) {
      contentByProject.set(doc.projectId, extractEditorText(doc.editorData));
    }

    let indexed = 0;
    for (const project of projects || []) {
      const projectId = String(project.id);
      await this.upsertIndex(projectId, {
        projectName: project.project_name,
        projectDesc: project.project_desc || '',
        contentText: contentByProject.get(projectId) || '',
      });
      indexed++;
    }
    /* 存在文档但项目表已无对应记录时，也补齐索引，避免删除孤儿文档搜不到 */
    for (const doc of documents || []) {
      const projectId = String(doc.projectId);
      if ((projects || []).some((p) => String(p.id) === projectId)) continue;
      await this.upsertIndex(projectId, {
        projectName: doc.projectName,
        contentText: contentByProject.get(projectId) || '',
      });
      indexed++;
    }
    return { indexed };
  }

  /**
   * 全文检索：tsvector + GIN 主路径(ts_rank 排序)，ILIKE 兜底补充子串命中。
   * 返回条数受 limit 限制，total 为 tsvector 命中总数。
   */
  async search(rawQuery: string, limit?: number | string): Promise<SearchResult> {
    const query = sanitizeSearchQuery(rawQuery);
    const pageSize = normalizeLimit(limit);
    if (!query) {
      return { list: [], total: 0, query: '' };
    }

    try {
      const tokens = buildIndexTokens(query, MAX_QUERY_LEN * 4);
      const tsQuery = tokens
        ? `plainto_tsquery('${TS_CONFIG}', $1)`
        : null;

      let ranked: any[] = [];
      let total = 0;
      if (tsQuery) {
        const countRows = await this.dataSource.query(
          `SELECT count(*)::int AS total FROM "${SEARCH_INDEX_TABLE}" WHERE search_vector @@ ${tsQuery}`,
          [tokens],
        );
        total = countRows?.[0]?.total ?? 0;
        ranked = await this.dataSource.query(
          `SELECT project_id, project_name, project_desc, content_text, update_time,
                  ts_rank(search_vector, ${tsQuery}) AS rank
             FROM "${SEARCH_INDEX_TABLE}"
            WHERE search_vector @@ ${tsQuery}
            ORDER BY rank DESC, update_time DESC
            LIMIT $2`,
          [tokens, pageSize],
        );
      }

      const list = (ranked || []).map((row) => toHit(row, row.rank));

      /* tsvector 未覆盖(如纯符号、超长中文串)时用 ILIKE 兜底，去重后补足一页 */
      if (list.length < pageSize) {
        const pattern = `%${escapeLikePattern(query).slice(0, MAX_QUERY_LEN)}%`;
        const excludeIds = list.map((hit) => hit.projectId);
        const fallback = await this.dataSource.query(
          `SELECT project_id, project_name, project_desc, content_text, update_time, 0 AS rank
             FROM "${SEARCH_INDEX_TABLE}"
            WHERE (project_name ILIKE $1 OR project_desc ILIKE $1 OR content_text ILIKE $1)
              AND NOT (project_id = ANY($2::varchar[]))
            ORDER BY update_time DESC
            LIMIT $3`,
          [pattern, excludeIds, pageSize - list.length],
        );
        for (const row of fallback || []) {
          list.push(toHit(row, 0));
        }
        if (!total) total = list.length;
      }

      return { list, total, query };
    } catch (err) {
      logger.error('全文检索失败', err as any);
      throw new HttpException(
        '检索失败',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

function normalizeLimit(limit?: number | string): number {
  const parsed = typeof limit === 'number' ? limit : parseInt(String(limit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function toHit(row: any, rank: number): SearchHit {
  return {
    projectId: String(row.project_id),
    projectName: row.project_name || '',
    projectDesc: row.project_desc || '',
    contentSnippet: (row.content_text || '').slice(0, 120),
    updateTime: row.update_time ? new Date(row.update_time).toISOString() : null,
    rank: Number(rank) || 0,
  };
}
