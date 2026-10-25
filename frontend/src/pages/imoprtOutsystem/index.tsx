/*
 * @Author: yangsen
 * @Date: 2022-04-13 17:19:49
 * @LastEditTime: 2026-10-20
 * @Description: 导出外部系统 —— Neon Dark 暗色适配
 */

import styled from "@emotion/styled";
import { Button, Tabs } from "antd";
import { useNavigate } from "react-router-dom";
import { OutSysLLGK } from "./outsystem/lianluguankong";

export const ImportOutSystem = () => {
  const navigate = useNavigate();
  return (
    <div style={{ position: "relative", minHeight: "100vh", padding: "28px 32px 48px" }}>
      <div className="yt-atmo" />
      <PageHeader>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--yt-text-primary)" }}>
          X6JSON 导入外部系统
        </div>
        <Button
          onClick={() => {
            navigate("/");
          }}
        >
          返回图集
        </Button>
      </PageHeader>
      <Container>
        <Tabs tabPosition="left" style={{ height: 400 }}>
          <Tabs.TabPane tab="数据治理系统" key="1">
            <OutSysLLGK />
          </Tabs.TabPane>
        </Tabs>
      </Container>
    </div>
  );
};

const PageHeader = styled.header`
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
const Container = styled.div`
  position: relative;
  z-index: 1;
  width: 80%;
  margin: 0 auto;
  padding: 22px 26px;
  background: var(--yt-glass);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--yt-border);
  border-radius: 16px;
  box-shadow: 0 12px 48px rgba(2, 6, 18, 0.55);
`;
