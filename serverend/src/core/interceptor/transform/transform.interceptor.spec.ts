import { Reflector } from '@nestjs/core';
import { TransformInterceptor } from './transform.interceptor';

// 商业化首发修复：new TransformInterceptor() 缺少 Reflector 参数（TS 严格模式下
// 构造参数不可省略），spec 一直编译失败；改为传入真实 Reflector。
describe('TransformInterceptor', () => {
  it('should be defined', () => {
    expect(new TransformInterceptor(new Reflector())).toBeDefined();
  });
});
