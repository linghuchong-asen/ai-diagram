// 语图技术方案 - Task 5.3：modify 应用计划的 Modal 承载
// antd 4 Modal + ApplyPlanPanel（纯受控组件）：勾选集合 / 歧义裁决 / 应用中标记全部由浮窗持有，
// 面板 onConfirm 上抛后由浮窗执行 applyOperations 并把 report 回传给面板展示残差。
// 关闭前若正在应用则禁止关闭（防止应用中丢失上下文）。

import { Button, Modal } from 'antd';
import ApplyPlanPanel from '../match/ApplyPlanPanel';
import type { ApplyPlan, ApplyReport } from '../match/apply-operations';

export interface ModifyPlanModalProps {
  open: boolean;
  plan: ApplyPlan;
  /** 受控：当前勾选执行的项下标 */
  selectedIndexes: number[];
  /** 受控：歧义裁决（项下标 → 画布元素 id） */
  resolvedAmbiguous: Record<number, string>;
  /** 上一次 applyOperations 的报告（含残差），面板内回显 */
  report: ApplyReport | null;
  /** 应用中（确认按钮 loading、禁止关闭） */
  applying: boolean;
  onSelectionChange: (next: number[]) => void;
  onResolutionChange: (next: Record<number, string>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ModifyPlanModal(props: ModifyPlanModalProps) {
  const {
    open,
    plan,
    selectedIndexes,
    resolvedAmbiguous,
    report,
    applying,
    onSelectionChange,
    onResolutionChange,
    onConfirm,
    onClose,
  } = props;

  return (
    <Modal
      title="AI 修改计划确认"
      visible={open}
      onCancel={onClose}
      width={680}
      maskClosable={!applying}
      footer={[
        <Button key="close" size="small" onClick={onClose} disabled={applying}>
          关闭
        </Button>,
      ]}
    >
      <ApplyPlanPanel
        plan={plan}
        selectedIndexes={selectedIndexes}
        resolvedAmbiguous={resolvedAmbiguous}
        onSelectionChange={onSelectionChange}
        onResolutionChange={onResolutionChange}
        onConfirm={onConfirm}
        applying={applying}
        report={report ?? undefined}
        maxHeight={360}
      />
    </Modal>
  );
}
