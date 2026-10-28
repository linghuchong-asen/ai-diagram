// 模型偏好工具 check（model-routing-batch）:选项契约 / 净化函数 / 存取回读
// 运行:npx tsx src/utils/__checks__/modelPreference.check.ts
import {
  describe,
  it,
  assertTrue,
  finish,
} from '../../pages/ai/__checks__/check-util';
import {
  MODEL_PREFERENCE_OPTIONS,
  isModelPreference,
  sanitizeModelPreference,
  loadModelPreference,
  saveModelPreference,
  type ModelPreference,
} from '../modelPreference';

describe('MODEL_PREFERENCE_OPTIONS 选项契约', () => {
  it('三个选项且 auto 恒在首位(默认值)', () => {
    assertTrue(MODEL_PREFERENCE_OPTIONS.length === 3, '应有 3 个选项');
    assertTrue(MODEL_PREFERENCE_OPTIONS[0].value === 'auto', 'auto 必须是第一个选项');
    const values = MODEL_PREFERENCE_OPTIONS.map((o) => o.value);
    assertTrue(new Set(values).size === 3, '选项值不得重复');
  });

  it('flagship 标记 vipOnly,其余不标', () => {
    const flagship = MODEL_PREFERENCE_OPTIONS.find((o) => o.value === 'flagship');
    const others = MODEL_PREFERENCE_OPTIONS.filter((o) => o.value !== 'flagship');
    assertTrue(flagship?.vipOnly === true, 'flagship 必须标记 vipOnly');
    assertTrue(others.every((o) => !o.vipOnly), '非旗舰档不得标记 vipOnly');
  });
});

describe('sanitizeModelPreference / isModelPreference', () => {
  it('合法值原样通过', () => {
    const all: ModelPreference[] = ['auto', 'flagship', 'flash'];
    for (const v of all) {
      assertTrue(isModelPreference(v), `${v} 应合法`);
      assertTrue(sanitizeModelPreference(v) === v, `${v} 净化后不变`);
    }
  });

  it('脏数据一律回落 auto(localStorage 内容不可信)', () => {
    for (const dirty of [undefined, null, '', 'gpt-4', 'FLAGSHIP', 123, {}, ['auto']]) {
      assertTrue(sanitizeModelPreference(dirty) === 'auto', `脏值 ${String(dirty)} 应回落 auto`);
      assertTrue(!isModelPreference(dirty), `脏值 ${String(dirty)} 不应通过类型守卫`);
    }
  });
});

describe('localStorage 存取(带桩 window)', () => {
  it('保存后回读一致;清空后回落 auto', () => {
    // Node 环境无 window:挂最小桩(Text/check 环境约定,见 yutu-test-conventions)
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    try {
      saveModelPreference('flash');
      assertTrue(loadModelPreference() === 'flash', '保存 flash 后应回读 flash');
      saveModelPreference('flagship');
      assertTrue(loadModelPreference() === 'flagship', '覆盖保存后应回读新值');
      // 手工写入脏数据 → 回落 auto
      store.set('yt_model_preference', '"not-a-model"');
      assertTrue(loadModelPreference() === 'auto', '脏存储应回落 auto');
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('无 window 环境(直接调用)不抛错并回落 auto', () => {
    assertTrue(loadModelPreference() === 'auto', '无 localStorage 时应回落 auto');
    saveModelPreference('flash'); // 静默失败,不抛
  });
});

finish('modelPreference.check');
