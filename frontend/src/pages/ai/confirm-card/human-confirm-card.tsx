// 语图技术方案 - Task 5.4：人在回路确认卡片
// onNeedConfirm 挂起时在浮窗内渲染：reason + issues 列表 + candidates 单选（label+note）
// + accept/retry 两按钮；retry 可选填补充说明（≤500 字，映射 ConfirmRequest.instruction）。
// 本组件纯受控展示：不直接发起请求，裁决经 onDecide 上抛给父组件（父组件持有 ConfirmActions）。
// 确认前画布零变更：本组件不持有 graph 引用。

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Alert, Button, Input, Radio, Space, Tag } from 'antd';
import type { RadioChangeEvent } from 'antd/lib/radio';
import type { ConfirmChoice, HumanConfirmPayload } from '../../../utils/aiClient';

/** 与后端 ConfirmRequestSchema 一致的补充约束上限 */
export const INSTRUCTION_MAX_LEN = 500;

export interface HumanConfirmCardProps {
  payload: HumanConfirmPayload;
  /** 提交中：按钮 loading 并禁用，防止重复提交 */
  submitting: boolean;
  /** 用户裁决上抛：choice + 补充说明（retry 时）+ 选定候选 id */
  onDecide: (choice: ConfirmChoice, instruction?: string, candidateId?: string) => void;
}

const noteStyle: CSSProperties = { fontSize: 12, color: 'var(--yt-text-muted)', marginLeft: 22 };

export default function HumanConfirmCard({ payload, submitting, onDecide }: HumanConfirmCardProps) {
  // 默认选中首个候选；候选集在挂起期内不变，可直接以首值初始化
  const [candidateId, setCandidateId] = useState<string>(() => payload.candidates[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');

  const submit = (choice: ConfirmChoice) => {
    if (submitting) return;
    const trimmed = instruction.trim().slice(0, INSTRUCTION_MAX_LEN);
    onDecide(choice, trimmed.length > 0 ? trimmed : undefined, candidateId || undefined);
  };

  const onInstructionChange = (event: { target: { value: string } }) => setInstruction(event.target.value);
  const onCandidateChange = (event: RadioChangeEvent) => setCandidateId(String(event.target.value ?? ''));

  return (
    <div
      style={{
        border: '1px solid rgba(250, 173, 20, 0.45)',
        borderRadius: 10,
        padding: 12,
        background: 'rgba(250, 173, 20, 0.07)',
      }}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 8 }}
        message="AI 需要人工确认"
        description={payload.reason || '请确认后继续'}
      />

      {payload.issues.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          {payload.issues.map((issue, index) => (
            <div key={`${issue.layer}-${index}`} style={{ marginBottom: 4, fontSize: 12, color: 'var(--yt-text-secondary)' }}>
              <Tag color="orange" style={{ marginRight: 4 }}>{issue.layer}</Tag>
              {issue.message}
              {issue.nodeIds && issue.nodeIds.length > 0 ? (
                <span style={{ color: 'var(--yt-text-muted)' }}>（涉及 {issue.nodeIds.length} 个节点）</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {payload.candidates.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--yt-text-secondary)', marginBottom: 4 }}>候选方案：</div>
          <Radio.Group value={candidateId} onChange={onCandidateChange} disabled={submitting}>
            <Space direction="vertical" size={4}>
              {payload.candidates.map((candidate) => (
                <Radio key={candidate.id} value={candidate.id}>
                  <span style={{ fontSize: 13 }}>{candidate.label}</span>
                  {candidate.note ? <div style={noteStyle}>{candidate.note}</div> : null}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>
      ) : null}

      <Input.TextArea
        value={instruction}
        onChange={onInstructionChange}
        maxLength={INSTRUCTION_MAX_LEN}
        placeholder="重试时可补充一句话约束（≤500 字，可选）"
        autoSize={{ minRows: 1, maxRows: 3 }}
        disabled={submitting}
        style={{ marginBottom: 8 }}
      />

      <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="small" disabled={submitting} onClick={() => submit('retry')}>
          {instruction.trim().length > 0 ? '重试（带补充说明）' : '重试'}
        </Button>
        <Button size="small" type="primary" className="yt-btn-primary" loading={submitting} onClick={() => submit('accept')}>
          采纳并继续
        </Button>
      </Space>
    </div>
  );
}
