/*
 * @Description: SQL 建表语句 → 表关系图 builder（Round H）
 * 市场需求：DBDoc/ER 图是开发常青需求，Eraser $45/席/月、中文免费版有空档（调研结论）。
 * 输入约定：一段或多段 CREATE TABLE 语句（MySQL/PostgreSQL 通用子集），
 *   反引号/双引号包裹的表名列名均可，内联 FOREIGN KEY ... REFERENCES 可识别。
 * 输出：实体（表 + 关键字段）与关系（外键方向）结构化的表关系图生成指令。
 */

import type { ScenarioConfig } from "../registry";

/** 解析出的表实体 */
export interface SqlTable {
  name: string;
  /** 关键字段（列名 + 类型），最多取 5 个避免 prompt 膨胀 */
  columns: Array<{ name: string; type: string }>;
  /** 主键列（PRIMARY KEY 行或列级约束识别；识别不到为 null） */
  primaryKey: string | null;
}

/** 解析出的关系（外键方向：source 含 FK 列 → target 被 REFERENCES） */
export interface SqlRelation {
  source: string;
  target: string;
  /** 外键列名（识别不到为 null） */
  column: string | null;
}

export interface DdlParseResult {
  tables: SqlTable[];
  relations: SqlRelation[];
}

/** 去掉标识符包裹（`name` / "name" / [name]） */
function unwrapIdentifier(token: string): string {
  return token.replace(/^[`"\[]|[`"\]]$/g, '').trim();
}

/** 列级/表级关键字（这些行不是普通列定义） */
const NON_COLUMN_KEYWORDS = /^(constraint|primary\s+key|foreign\s+key|unique(\s+key|\s+index)?|key|index|check|create\s+table|\)|\()/i;

/**
 * 解析 CREATE TABLE 语句集合（纯函数，宽松容错）。
 * 规则：按 CREATE TABLE 切块 → 块内取表名 → 括号体内逐行分析列/约束；
 *   REFERENCES 识别关系（表级/列级两种写法都支持）。
 */
export function parseDdl(raw: string): DdlParseResult {
  const text = String(raw ?? '')
    .replace(/--[^\n]*/g, ' ') // 去行注释
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // 去块注释
  const tables: SqlTable[] = [];
  const relations: SqlRelation[] = [];

  // 按 CREATE TABLE 切块（大小写不敏感）
  const blocks = text.split(/create\s+table\s+/i).slice(1);
  for (const block of blocks) {
    // 表名：首个标识符（含包裹符或直接词）
    const nameMatch = block.match(/^([`"\[]?[\w]+[`"\]]?)/);
    if (!nameMatch) continue;
    const tableName = unwrapIdentifier(nameMatch[1]);
    if (!tableName) continue;

    // 括号体：首个 ( 到配对的最后一个 )（宽松取到块尾兜底）
    const openIndex = block.indexOf('(');
    if (openIndex === -1) {
      tables.push({ name: tableName, columns: [], primaryKey: null });
      continue;
    }
    const closeIndex = block.lastIndexOf(')');
    const body = block.slice(openIndex + 1, closeIndex > openIndex ? closeIndex : undefined);

    const table: SqlTable = { name: tableName, columns: [], primaryKey: null };
    // 顶层逗号切分（不处理嵌套括号内的逗号：类型长度/枚举值）
    const parts = splitTopLevel(body);
    for (const part of parts) {
      const line = part.trim().replace(/,$/, '').trim();
      if (!line) continue;

      // 表级外键：FOREIGN KEY (col) REFERENCES target(col)
      const fk = line.match(/^foreign\s+key\s*\(\s*[`"\[]?(\w+)[`"\]]?\s*\)\s*references\s+[`"\[]?(\w+)[`"\]]?/i);
      if (fk) {
        relations.push({ source: tableName, target: unwrapIdentifier(fk[2]), column: fk[1] });
        continue;
      }
      // 表级主键：PRIMARY KEY (col)
      const pk = line.match(/^primary\s+key\s*\(\s*[`"\[]?(\w+)[`"\]]?\s*\)/i);
      if (pk) {
        table.primaryKey = pk[1];
        continue;
      }
      // 其余表级约束行跳过
      if (NON_COLUMN_KEYWORDS.test(line)) continue;

      // 列级：col type...（含列级 REFERENCES / PRIMARY KEY 内联识别）
      const colMatch = line.match(/^[`"\[]?(\w+)[`"\]]?\s+([a-zA-Z]+)/);
      if (!colMatch) continue;
      const columnName = colMatch[1];
      const columnType = colMatch[2].toLowerCase();
      if (columnName.toLowerCase() === 'primary') continue; // 防御 primary key( 拆行
      table.columns.push({ name: columnName, type: columnType });

      if (/\bprimary\s+key\b/i.test(line)) table.primaryKey = columnName;
      const inlineRef = line.match(/references\s+[`"\[]?(\w+)[`"\]]?/i);
      if (inlineRef) {
        relations.push({ source: tableName, target: unwrapIdentifier(inlineRef[1]), column: columnName });
      }
    }
    table.columns = table.columns.slice(0, 5);
    tables.push(table);
  }

  // 关系去重（同 source+target+column 只留一条）
  const seen = new Set<string>();
  const uniqueRelations = relations.filter((relation) => {
    const key = `${relation.source}|${relation.target}|${relation.column ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { tables, relations: uniqueRelations };
}

/** 顶层逗号切分（括号深度为 0 时的逗号才切） */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** 解析结果 → 表关系图生成指令（实体带关键字段 + 外键关系 N:1 方向） */
export function buildDdlPrompt(result: DdlParseResult): string {
  const entityLines = result.tables
    .map((table) => {
      const pk = table.primaryKey ? `主键 ${table.primaryKey}` : '主键未标注';
      const cols = table.columns.map((column) => column.name).join('、');
      return `${table.name}（${pk}；字段：${cols || '未解析到字段'}）`;
    })
    .join('；');
  const relationLines = result.relations
    .map(
      (relation) =>
        `${relation.source}.${relation.column ?? '?'} 指向 ${relation.target}（多对一）`,
    )
    .join('；');
  const relationPart = relationLines
    ? `外键关系：${relationLines}，用带箭头的连线标注方向与外键名`
    : '未识别到外键，请按字段命名的语义合理推测表间关系并用虚线标注「推测」';
  return (
    `画一张数据库表关系图（类 ER 图）：${entityLines}。${relationPart}。` +
    '每张表用一个矩形节点表示（节点内列出表名与关键字段），主键字段标注 PK，' +
    '外键关系用箭头连线并标注外键字段名，整体按引用方向从左到右排布'
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const sqlDdlScenario: ScenarioConfig = {
  id: "sql-ddl",
  name: "建表语句转表关系图",
  tagline: "粘贴 CREATE TABLE，生成带外键关系的表关系图",
  emoji: "🗄️",
  maxLength: 500,
  placeholder:
    "粘贴一段建表语句（MySQL/PG 通用），例如：\nCREATE TABLE user (\n  id BIGINT PRIMARY KEY,\n  name VARCHAR(50)\n);\nCREATE TABLE order (\n  id BIGINT PRIMARY KEY,\n  user_id BIGINT,\n  FOREIGN KEY (user_id) REFERENCES user(id)\n);",
  examples: [
    {
      label: "示例：电商三表",
      text: "CREATE TABLE user (id BIGINT PRIMARY KEY, name VARCHAR(50), phone VARCHAR(20));\nCREATE TABLE order (id BIGINT PRIMARY KEY, user_id BIGINT, amount DECIMAL(10,2), FOREIGN KEY (user_id) REFERENCES user(id));\nCREATE TABLE order_item (id BIGINT PRIMARY KEY, order_id BIGINT, sku VARCHAR(64), FOREIGN KEY (order_id) REFERENCES order(id));",
    },
  ],
  buildPrompt: (text) => buildDdlPrompt(parseDdl(text)),
  channel: "scenario:sql-ddl",
};
