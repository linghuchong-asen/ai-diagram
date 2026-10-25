/*
 * @Description: 语图用户服务协议页面（路由 /agreement）
 */
import { Typography } from "antd";
import LegalLayout from "./layout";

const { Paragraph } = Typography;

/** 语图用户服务协议 */
export const AgreementPage = () => (
  <LegalLayout title="语图用户服务协议" updatedAt="2026-10-20">
    <Paragraph>
      1. 服务说明：语图（Yutu）是一款 AI 辅助流程图创作工具。你以自然语言描述需求，由 AI
      为你生成或修改流程图，你也可以在画布上手动编辑图形内容。
    </Paragraph>
    <Paragraph>
      2. 账号：你注册账号时须设置密码并妥善保管。你应对账号下的全部活动负责。未经许可，禁止转让、共用账号。
    </Paragraph>
    <Paragraph>
      3.
      配额与免费策略：当前为免费公测阶段，每个账号每日的 AI 生成/修改次数与 token
      用量设有上限，超出上限后当日不可继续使用 AI
      功能。公测期额度可能调整，以产品内提示为准。
    </Paragraph>
    <Paragraph>
      4. 用户内容：你创建与上传的项目内容归你所有。为向你提供服务之必需，你授予语图对相关内容的存储、处理权限。
    </Paragraph>
    <Paragraph>
      5. AI
      生成内容免责：AI 生成结果由算法产生，可能存在错误或不准确之处，仅供辅助参考。你应在采用前自行审查，AI
      生成内容不构成任何专业建议。
    </Paragraph>
    <Paragraph>
      6.
      行为规范：你不得利用本服务从事违法违规活动、提交违法内容、恶意消耗配额或攻击服务。
    </Paragraph>
    <Paragraph>
      7.
      服务变更与中断：公测期内服务按“现状”提供，我们可能随时对服务进行调整、暂停或终止，不保证服务不间断。
    </Paragraph>
    <Paragraph>
      8.
      免责与责任限制：在法律允许的范围内，语图对间接损失、数据丢失不承担责任；语图的累计赔偿责任不超过你为服务支付的费用（公测期为免费，即为零）。
    </Paragraph>
    <Paragraph>9. 协议变更：我们可能更新本协议，重大变更将在产品内提示。</Paragraph>
    <Paragraph>10. 其他：本协议适用中华人民共和国法律。</Paragraph>
    <Paragraph>如有疑问请联系：***</Paragraph>
  </LegalLayout>
);
