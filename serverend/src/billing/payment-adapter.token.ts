// 语图商业化闭环批次 - 支付适配器 DI token
// 独立成文件避免「接口 token 与实现互相 import」的循环依赖嫌疑：
// billing.service 只 import 本 token 与接口；具体通道由 billing.module 工厂按
// env PAY_CHANNEL 选择（mock 沙箱 / xunhupay 真实通道，默认 xunhupay）。
export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');
