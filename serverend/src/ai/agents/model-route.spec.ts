// 语图技术方案 - 模型档位路由单元测试(model-routing-batch)
// 覆盖:复杂度确定性规则 / 档位决策优先级(试用强制 > 手选直通 > Auto 分层 > 保守默认)/ 会员闸门
import { decideGenerationTier, estimateComplexityByRules } from './model-route';

describe('estimateComplexityByRules(零 token 复杂度规则)', () => {
  it('空输入按简单处理', () => {
    expect(estimateComplexityByRules('')?.complexity).toBe('simple');
    expect(estimateComplexityByRules('   ')?.complexity).toBe('simple');
  });

  it('短句无分支信号 → simple', () => {
    const r = estimateComplexityByRules('画一个请假审批流程图');
    expect(r?.complexity).toBe('simple');
    expect(r?.reason).toContain('短句');
  });

  it('单个分支信号 + 无箭头 → 拿不准返回 null(交给 llm/default 层)', () => {
    // 仅含 1 个信号词(如果),长度短但简单判定要求零信号 → 规则不敢单独下结论
    const r = estimateComplexityByRules('画一个流程:提交,如果不通过则备案');
    expect(r).toBeNull();
  });

  it('箭头密集(≥4)→ complex', () => {
    const r = estimateComplexityByRules('提交→审核→处理→打包→发货→归档');
    expect(r?.complexity).toBe('complex');
    expect(r?.reason).toContain('步骤分隔符多');
  });

  it('长描述(≥120 字)→ complex', () => {
    const long = '生成一个完整的订单处理流程'.padEnd(130, '描');
    const r = estimateComplexityByRules(long);
    expect(r?.complexity).toBe('complex');
    expect(r?.reason).toContain('长描述');
  });
});

describe('decideGenerationTier(生成档位决策)', () => {
  const base = { intent: 'generate' as const, query: '画一个流程图', isVip: false, isTrial: false };

  it('试用链路强制 flash(优先级最高,忽略手选偏好)', () => {
    const r = decideGenerationTier({ ...base, isTrial: true, modelPreference: 'flagship' });
    expect(r.tier).toBe('flash');
    expect(r.source).toBe('trial-force');
  });

  it('手选 flash → 直通 flash(与会员态无关)', () => {
    const r = decideGenerationTier({ ...base, modelPreference: 'flash' });
    expect(r.tier).toBe('flash');
    expect(r.source).toBe('preference');
  });

  it('会员手选 flagship → 直通 flagship', () => {
    const r = decideGenerationTier({ ...base, modelPreference: 'flagship', isVip: true });
    expect(r.tier).toBe('flagship');
    expect(r.source).toBe('preference');
  });

  it('非会员手选 flagship → 回落 Auto(按规则分层,不报错)', () => {
    // 短句无信号 → Auto 规则判 simple → flash
    const simple = decideGenerationTier({ ...base, modelPreference: 'flagship', isVip: false });
    expect(simple.tier).toBe('flash');
    expect(simple.source).toBe('rule');
    expect(simple.reasons.join()).toContain('需会员');
  });

  it('Auto + 规则判简单 → flash(零 token 快路径)', () => {
    const r = decideGenerationTier({ ...base, query: '请假审批流程' });
    expect(r.tier).toBe('flash');
    expect(r.source).toBe('rule');
    expect(r.complexity).toBe('simple');
    expect(r.complexitySource).toBe('rule');
  });

  it('Auto + 规则判复杂 → flagship', () => {
    const r = decideGenerationTier({
      ...base,
      query: '审批如果通过则备案,否则驳回退回重新提交',
    });
    expect(r.tier).toBe('flagship');
    expect(r.source).toBe('rule');
    expect(r.complexity).toBe('complex');
  });

  it('Auto + 规则拿不准 + 意图模型输出 simple → flash(复用意图那次调用,不额外花钱)', () => {
    // 中等长度 + 无信号词 + 无分隔符:规则返回 null,才轮得到 llm 层
    const medium =
      '生成一个部门协作流程图,由产品经理发起需求,设计师给出方案,工程师实现并自测,运营验收后正式发布,全程同步进展给相关负责人';
    expect(estimateComplexityByRules(medium)).toBeNull();
    const r = decideGenerationTier({ ...base, query: medium, llmComplexity: 'simple' });
    expect(r.tier).toBe('flash');
    expect(r.source).toBe('llm');
    expect(r.complexitySource).toBe('llm');
  });

  it('Auto + 规则与模型都拿不准 → 保守默认旗舰(质量优先)', () => {
    const medium =
      '生成一个部门协作流程图,由产品经理发起需求,设计师给出方案,工程师实现并自测,运营验收后正式发布,全程同步进展给相关负责人';
    expect(estimateComplexityByRules(medium)).toBeNull();
    const r = decideGenerationTier({ ...base, query: medium });
    expect(r.tier).toBe('flagship');
    expect(r.source).toBe('default');
    expect(r.complexity).toBe('complex');
  });

  it('undefined 偏好等价于 auto', () => {
    const r = decideGenerationTier({ ...base });
    expect(r.source).toBe('rule');
  });
});
