// 语图 Round H（SQL DDL 解析 builder）可执行断言脚本
// 覆盖：表名/列解析（含包裹符与类型括号）、表级/列级主键与外键、注释剔除、
//      列数截断、关系去重、非 DDL 输入防御、prompt 结构。
// 运行：cd frontend && npx tsx src/pages/scenarios/builders/__checks__/sql-ddl.check.ts

import { buildDdlPrompt, parseDdl, sqlDdlScenario } from '../sql-ddl';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../../ai/__checks__/check-util';

describe('parseDdl：表与列解析', () => {
  it('基础表：表名/列名/类型/表级主键', () => {
    const result = parseDdl(
      'CREATE TABLE user (\n  id BIGINT PRIMARY KEY,\n  name VARCHAR(50),\n  age INT\n);',
    );
    assertEqual(result.tables.length, 1, '一张表');
    assertEqual(result.tables[0].name, 'user', '表名');
    assertEqual(result.tables[0].primaryKey, 'id', '列级主键');
    assertEqual(result.tables[0].columns.length, 3, '三列');
    assertEqual(result.tables[0].columns[1].type, 'varchar', '类型小写归一');
  });

  it('反引号/双引号包裹与枚举类型括号内的逗号不切分', () => {
    const result = parseDdl(
      'CREATE TABLE `order` (`status` ENUM("paid","unpaid"), `note` TEXT);',
    );
    assertEqual(result.tables[0].name, 'order', '反引号表名去包裹');
    assertEqual(result.tables[0].columns.length, 2, '枚举括号内逗号不应切出新列');
    assertEqual(result.tables[0].columns[0].name, 'status', '列名去包裹');
  });

  it('表级 PRIMARY KEY 与 FOREIGN KEY ... REFERENCES', () => {
    const result = parseDdl(
      'CREATE TABLE t1 (id BIGINT, PRIMARY KEY (id));\nCREATE TABLE t2 (id BIGINT, t1_id BIGINT, FOREIGN KEY (t1_id) REFERENCES t1(id));',
    );
    assertEqual(result.tables[0].primaryKey, 'id', '表级主键');
    assertEqual(result.relations.length, 1, '一条外键关系');
    assertEqual(result.relations[0].source, 't2', '关系源表');
    assertEqual(result.relations[0].target, 't1', '关系目标表');
    assertEqual(result.relations[0].column, 't1_id', '外键列');
  });

  it('列级 REFERENCES（内联外键）与关系去重', () => {
    const result = parseDdl(
      'CREATE TABLE a (id BIGINT PRIMARY KEY);\nCREATE TABLE b (a_id BIGINT REFERENCES a(id));\nCREATE TABLE c (b_id BIGINT REFERENCES b(id));',
    );
    assertEqual(result.relations.length, 2, '两条内联关系');
    assertEqual(result.relations[0].target, 'a', '内联指向正确');
  });

  it('注释剔除（行注释与块注释）', () => {
    const result = parseDdl(
      'CREATE TABLE t ( -- 行注释\n id BIGINT /* 块\n注释 */, name TEXT\n);',
    );
    assertEqual(result.tables[0].columns.length, 2, '注释不应产生伪列');
  });

  it('超过 5 列截断（prompt 体积控制）', () => {
    const ddl =
      'CREATE TABLE wide (' +
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((c) => `${c} INT`).join(', ') +
      ');';
    assertEqual(parseDdl(ddl).tables[0].columns.length, 5, '至多 5 列');
  });

  it('非 DDL 输入防御：空文本/普通文字 → 空结果不抛错', () => {
    assertEqual(parseDdl('').tables.length, 0, '空输入');
    assertEqual(parseDdl('今天天气不错').tables.length, 0, '非 DDL 文本');
  });
});

describe('buildDdlPrompt：指令构造', () => {
  it('包含实体（表+主键+字段）与外键关系方向', () => {
    const prompt = buildDdlPrompt(
      parseDdl(
        'CREATE TABLE user (id BIGINT PRIMARY KEY, name VARCHAR(20));\nCREATE TABLE order (id BIGINT PRIMARY KEY, user_id BIGINT, FOREIGN KEY (user_id) REFERENCES user(id));',
      ),
    );
    assertTrue(prompt.includes('user') && prompt.includes('order'), '实体进入指令');
    assertTrue(prompt.includes('user_id'), '外键字段名进入指令');
    assertTrue(prompt.includes('多对一'), '关系基数方向标注');
    assertTrue(prompt.includes('PK'), '主键标注要求');
  });

  it('无外键时：降级为语义推测话术（诚实，不编造识别结果）', () => {
    const prompt = buildDdlPrompt(parseDdl('CREATE TABLE t (id INT, name TEXT);'));
    assertTrue(prompt.includes('推测'), '无外键时应说明按语义推测');
  });

  it('场景配置契约闭环', () => {
    assertEqual(sqlDdlScenario.id, 'sql-ddl', 'id');
    assertEqual(sqlDdlScenario.channel, 'scenario:sql-ddl', '渠道码');
    assertTrue(sqlDdlScenario.buildPrompt('CREATE TABLE t (id INT);').includes('t'), 'buildPrompt 走解析链');
  });
});

finish('sql-ddl');
