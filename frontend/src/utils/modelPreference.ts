/*
 * @Description: 模型偏好工具（model-routing-batch）—— 浮窗模型选择器的纯函数核心
 *               Trae 式模型选择:auto=智能路由(默认,后端按复杂度分档) / flagship=旗舰(会员) / flash=轻量。
 *               本模块只做「选项定义 + localStorage 读写与净化」,不发请求;
 *               网络层(utils/aiClient)与后端契约使用同一联合类型,避免两处漂移。
 */

/** 用户可选模型偏好(与后端 MODEL_PREFERENCES 白名单一致) */
export type ModelPreference = 'auto' | 'flagship' | 'flash';

/** 是否合法偏好值(运行时校验:localStorage 内容不可信,脏数据一律回落 auto) */
export function isModelPreference(value: unknown): value is ModelPreference {
  return value === 'auto' || value === 'flagship' || value === 'flash';
}

/** 净化任意来源的偏好值:非法/缺失一律回落 auto(智能路由) */
export function sanitizeModelPreference(value: unknown): ModelPreference {
  return isModelPreference(value) ? value : 'auto';
}

export interface ModelPreferenceOption {
  value: ModelPreference;
  label: string;
  /** 选择器里的简短说明(下拉项副标题) */
  desc: string;
  /** 旗舰档为会员权益:非会员禁用并提示开通 */
  vipOnly?: boolean;
}

/** 选择器选项(顺序即展示顺序;auto 恒在首位且为默认值) */
export const MODEL_PREFERENCE_OPTIONS: ModelPreferenceOption[] = [
  { value: 'auto', label: '智能路由', desc: 'Auto · 按需求复杂度自动分配模型' },
  { value: 'flagship', label: '旗舰模型', desc: '复杂流程质量优先 · 会员可手选', vipOnly: true },
  { value: 'flash', label: '轻量快速', desc: '简单流程极速出图' },
];

const STORAGE_KEY = 'yt_model_preference';

/** 读取本地偏好:脏数据/无 localStorage(隐私模式)一律回落 auto,绝不抛错 */
export function loadModelPreference(): ModelPreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeModelPreference(raw ? JSON.parse(raw) : raw);
  } catch {
    return 'auto';
  }
}

/** 保存本地偏好:旁路写入,失败(隐私模式/配额满)静默忽略 —— 偏好丢失只影响下次默认值 */
export function saveModelPreference(value: ModelPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 静默:localStorage 不可用不影响发送
  }
}
