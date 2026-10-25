// 语图技术方案 - frontend/index.md「人在回路：应用计划确认面板」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 3.4
// 要点：
//   1. **纯受控组件**：自身不持有任何状态，勾选集合 / 歧义裁决 / 应用中标记全部由父组件传入，
//      变更通过回调上抛（onSelectionChange / onResolutionChange / onConfirm / onReject）；
//   2. 逐项展示匹配等级（L1 绿 / L2 蓝 / L3 橙 / L4 红 / none 灰）、置信度、变更明细与原因；
//   3. 歧义项（ambiguous）给出候选单选，未裁决前不可勾选执行 —— 对应「L4 兜底必须人工确认」；
//   4. 未匹配残差与不可执行项用 Alert 显著提示，绝不静默丢弃；
//   5. 只依赖已安装的 antd 4，不新增依赖。

import type { CSSProperties } from 'react';
import { Alert, Button, Checkbox, Empty, List, Radio, Space, Tag } from 'antd';
import type { RadioChangeEvent } from 'antd/lib/radio';
import type { MatchLevel } from './match-level';
import { MATCH_LEVEL_LABEL } from './match-level';
import type { ApplyPlan, ApplyPlanItem, ApplyReport } from './apply-operations';

/** 匹配等级 → antd Tag 颜色（L1 绿 / L2 蓝 / L3 橙 / L4 红 / none 灰） */
export const MATCH_LEVEL_TAG_COLOR: Record<MatchLevel, string> = {
  L1: 'green',
  L2: 'blue',
  L3: 'orange',
  L4: 'red',
  none: 'default',
};

/** 操作类型 → 中文短名 */
export const PATCH_OP_TEXT: Record<string, string> = {
  modify_node: '改节点',
  modify_edge: '改边',
  add_node: '增节点',
  add_edge: '增边',
  delete_node: '删节点',
  delete_edge: '删边',
  reposition: '移动',
};

export interface ApplyPlanPanelProps {
  /** buildApplyPlan 产出的应用计划 */
  plan: ApplyPlan;
  /** 受控：当前勾选执行的项下标 */
  selectedIndexes: number[];
  /** 受控：歧义裁决（项下标 → 画布元素 id） */
  resolvedAmbiguous?: Record<number, string>;
  /** 勾选变更（返回全新数组，父组件直接 setState） */
  onSelectionChange?: (nextIndexes: number[]) => void;
  /** 歧义裁决变更（返回全新对象） */
  onResolutionChange?: (nextResolved: Record<number, string>) => void;
  /** 确认应用（父组件据此调用 applyOperations） */
  onConfirm?: () => void;
  /** 放弃本次修改 */
  onReject?: () => void;
  /** 应用中（确认按钮 loading） */
  applying?: boolean;
  /** 上一次 applyOperations 的报告，用于回显执行结果与残差 */
  report?: ApplyReport;
  /** 面板高度（超出滚动） */
  maxHeight?: number;
  style?: CSSProperties;
  className?: string;
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8 };
const titleStyle: CSSProperties = { fontSize: 13, color: '#262626', fontWeight: 500 };
const detailStyle: CSSProperties = { fontSize: 12, color: '#595959', marginTop: 2 };
const reasonStyle: CSSProperties = { fontSize: 12, color: '#8C8C8C', marginTop: 2 };
const blockedReasonStyle: CSSProperties = { fontSize: 12, color: '#CF1322', marginTop: 2 };
const candidateStyle: CSSProperties = { marginTop: 6 };
const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 12,
};

function confidenceText(confidence: number): string {
  const safe = Number.isFinite(confidence) ? confidence : 0;
  return `置信度 ${(safe * 100).toFixed(0)}%`;
}

/** 该项在「已裁决」后是否仍不可执行 */
function isEffectivelyBlocked(item: ApplyPlanItem, resolvedId?: string): boolean {
  if (!item.blocked) return false;
  // 歧义项一旦被人工选定即可执行（父组件通常会据此重算 plan）
  if (item.ambiguous && resolvedId) return false;
  return true;
}

/**
 * 应用计划确认面板（纯受控）。
 * 父组件典型用法：
 *   const plan = useMemo(() => buildApplyPlan(operations, snapshot, resolved), [operations, snapshot, resolved]);
 *   <ApplyPlanPanel plan={plan} selectedIndexes={selected} resolvedAmbiguous={resolved}
 *     onSelectionChange={setSelected} onResolutionChange={setResolved}
 *     onConfirm={() => setReport(applyOperations(snapshot, operations, { selectedIndexes: selected, resolvedAmbiguous: resolved }))} />
 */
export default function ApplyPlanPanel(props: ApplyPlanPanelProps) {
  const {
    plan,
    selectedIndexes,
    resolvedAmbiguous,
    onSelectionChange,
    onResolutionChange,
    onConfirm,
    onReject,
    applying = false,
    report,
    maxHeight = 320,
    style,
    className,
  } = props;

  const items = plan?.items ?? [];
  const selected = new Set(selectedIndexes ?? []);

  const toggle = (index: number, checked: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (checked) next.add(index);
    else next.delete(index);
    onSelectionChange(items.filter((item) => next.has(item.index)).map((item) => item.index));
  };

  const selectAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(
      items
        .filter((item) => !isEffectivelyBlocked(item, resolvedAmbiguous?.[item.index]))
        .map((item) => item.index),
    );
  };

  const selectNone = () => {
    if (!onSelectionChange) return;
    onSelectionChange([]);
  };

  const resolveCandidate = (index: number, event: RadioChangeEvent) => {
    if (!onResolutionChange) return;
    const value = event?.target?.value;
    const next: Record<number, string> = { ...(resolvedAmbiguous ?? {}) };
    if (typeof value === 'string' && value.length > 0) {
      next[index] = value;
      // 裁决后默认勾选该项，减少一次点击
      if (!selected.has(index)) {
        const indexes = Array.from(new Set([...(selectedIndexes ?? []), index]));
        onSelectionChange?.(indexes);
      }
    } else {
      delete next[index];
    }
    onResolutionChange(next);
  };

  const actionable = items.filter(
    (item) => !isEffectivelyBlocked(item, resolvedAmbiguous?.[item.index]),
  );
  const blockedItems = items.filter((item) =>
    isEffectivelyBlocked(item, resolvedAmbiguous?.[item.index]),
  );
  const ambiguousPending = items.filter(
    (item) => item.ambiguous && !resolvedAmbiguous?.[item.index],
  );
  const residual = report?.residual ?? [];
  const selectedCount = items.filter((item) => selected.has(item.index)).length;

  if (items.length === 0) {
    return (
      <div className={className} style={style}>
        <Empty description="本次没有需要确认的修改" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      {ambiguousPending.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${ambiguousPending.length} 项匹配存在歧义，请先在下方选定目标元素`}
        />
      ) : null}

      {blockedItems.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${blockedItems.length} 项无法在画布上定位（残差），将不会被执行`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {blockedItems.slice(0, 5).map((item) => (
                <li key={item.index}>
                  第 {item.index + 1} 项 {item.title}：{item.reason}
                </li>
              ))}
              {blockedItems.length > 5 ? <li>…等共 {blockedItems.length} 项</li> : null}
            </ul>
          }
        />
      ) : null}

      {residual.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`上次应用跳过 ${residual.length} 项`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {residual.slice(0, 5).map((item) => (
                <li key={item.index}>
                  第 {item.index + 1} 项（{item.skip ?? 'skipped'}）：{item.reason}
                </li>
              ))}
              {residual.length > 5 ? <li>…等共 {residual.length} 项</li> : null}
            </ul>
          }
        />
      ) : null}

      <List<ApplyPlanItem>
        size="small"
        bordered
        style={{ maxHeight, overflowY: 'auto' }}
        dataSource={items}
        rowKey={(item) => item.index}
        renderItem={(item) => {
          const resolvedId = resolvedAmbiguous?.[item.index];
          const blocked = isEffectivelyBlocked(item, resolvedId);
          return (
            <List.Item key={item.index} style={{ opacity: blocked ? 0.65 : 1 }}>
              <div style={{ width: '100%' }}>
                <div style={rowStyle}>
                  <Checkbox
                    checked={selected.has(item.index)}
                    disabled={blocked}
                    onChange={(event) => toggle(item.index, event.target.checked)}
                  />
                  <Tag color={MATCH_LEVEL_TAG_COLOR[item.level] ?? 'default'}>{item.level}</Tag>
                  <Tag>{PATCH_OP_TEXT[item.kind] ?? item.kind}</Tag>
                  <span style={titleStyle}>{item.title}</span>
                </div>
                <div style={detailStyle}>{item.detail}</div>
                <div style={blocked ? blockedReasonStyle : reasonStyle}>
                  {MATCH_LEVEL_LABEL[item.level] ?? item.level} · {confidenceText(item.confidence)} ·{' '}
                  {item.reason}
                </div>
                {item.ambiguous && item.candidates.length > 0 ? (
                  <div style={candidateStyle}>
                    <Radio.Group
                      size="small"
                      value={resolvedId ?? ''}
                      onChange={(event) => resolveCandidate(item.index, event)}
                    >
                      <Space direction="vertical" size={2}>
                        {item.candidates.map((candidate) => (
                          <Radio key={candidate.id} value={candidate.id}>
                            {candidate.label}
                            <span style={reasonStyle}> #{candidate.id}</span>
                          </Radio>
                        ))}
                      </Space>
                    </Radio.Group>
                  </div>
                ) : null}
              </div>
            </List.Item>
          );
        }}
      />

      <div style={footerStyle}>
        <Space size={8}>
          <Button size="small" onClick={selectAll} disabled={applying || actionable.length === 0}>
            全选可执行（{actionable.length}）
          </Button>
          <Button size="small" onClick={selectNone} disabled={applying}>
            全不选
          </Button>
        </Space>
        <Space size={8}>
          <span style={reasonStyle}>已选 {selectedCount} / {items.length}</span>
          {onReject ? (
            <Button size="small" onClick={onReject} disabled={applying}>
              放弃
            </Button>
          ) : null}
          {onConfirm ? (
            <Button
              size="small"
              type="primary"
              loading={applying}
              disabled={selectedCount === 0}
              onClick={onConfirm}
            >
              应用所选修改
            </Button>
          ) : null}
        </Space>
      </div>
    </div>
  );
}
