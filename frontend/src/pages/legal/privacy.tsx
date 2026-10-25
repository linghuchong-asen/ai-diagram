/*
 * @Description: 语图隐私政策页面（路由 /privacy）
 */
import { Typography } from "antd";
import LegalLayout from "./layout";

const { Paragraph } = Typography;

/** 语图隐私政策 */
export const PrivacyPage = () => (
  <LegalLayout title="语图隐私政策" updatedAt="2026-10-20">
    <Paragraph>
      1. 我们收集的信息：注册信息（用户名、加密后的密码）；使用数据（AI
      对话内容与画布数据、每日用量统计、操作日志、IP 地址）。
    </Paragraph>
    <Paragraph>
      2. 我们如何使用：收集的信息用于提供与改进服务、配额计量、安全防护与反滥用。
    </Paragraph>
    <Paragraph>
      3. AI
      处理与第三方：为生成流程图，你的对话内容将传输至我们使用的第三方大模型服务（阿里云通义千问
      DashScope）处理；我们仅传输为生成所必需的内容。
    </Paragraph>
    <Paragraph>
      4. 存储与保留：你的数据存储于中国境内的服务器；日志保留期与备份保留 14
      天以上，不超过必要期限。
    </Paragraph>
    <Paragraph>
      5.
      你的权利：你可以通过联系我们提供的邮箱查询、更正、删除你的数据；如需注销账号，也可通过该邮箱申请注销通道，我们将在验证身份后为你办理。
    </Paragraph>
    <Paragraph>
      6. 安全措施：我们采取传输加密、密码单向加密存储、访问控制等措施保护你的数据安全。
    </Paragraph>
    <Paragraph>7. 未成年人：本服务不面向未满 14 周岁的未成年人。</Paragraph>
    <Paragraph>8. 政策更新与联系方式：本政策可能更新，重大变更将在产品内提示。如有疑问，请通过产品内公布的联系方式与我们联系。</Paragraph>
  </LegalLayout>
);
