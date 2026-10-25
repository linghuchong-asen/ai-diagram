// 语图技术方案 - ModifyPatchOutput(modify 场景输出结构)
// 增量操作序列,7 种 op:
//   modify_node / modify_edge / add_node / add_edge / delete_node / delete_edge / reposition
// 通过 semantic/visual 字段区分结构与视觉变更;visual 为受限枚举
import { z } from 'zod';
import { NODE_TYPES } from './node.schema';

// ---- 视觉受限枚举(防幻觉:只能从白名单取) ----
const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
const FONT_SIZES = [12, 14, 16, 18, 20] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const VisualChangeSchema = z
  .object({
    borderStyle: z.enum(BORDER_STYLES).optional(),
    borderWidth: z.number().int().min(1).max(5).optional(),
    fillColor: z.string().regex(HEX_COLOR, '必须是 #RRGGBB 格式').optional(),
    fontColor: z.string().regex(HEX_COLOR, '必须是 #RRGGBB 格式').optional(),
    fontSize: z.union(FONT_SIZES.map((s) => z.literal(s))).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'visual 至少包含一个字段');

export type VisualChange = z.infer<typeof VisualChangeSchema>;

// ---- 定位语义(reposition / add_node) ----
const DirectionSchema = z.enum(['top', 'bottom', 'left', 'right']);
const PositionSchema = z.object({
  relativeTo: z.object({ label: z.string() }).describe('参照节点(按 label 定位)'),
  direction: DirectionSchema,
});

// ---- 7 种 op 定义 ----
export const ModifyNodeOpSchema = z.object({
  op: z.literal('modify_node'),
  target: z.object({ type: z.literal('node'), oldLabel: z.string() }),
  semantic: z
    .object({
      label: z.string().optional(),
      nodeType: z.enum(NODE_TYPES).optional(),
    })
    .optional(),
  visual: VisualChangeSchema.optional(),
});

export const ModifyEdgeOpSchema = z.object({
  op: z.literal('modify_edge'),
  target: z.object({ type: z.literal('edge'), oldLabel: z.string().optional() }),
  semantic: z
    .object({
      label: z.string().optional(),
    })
    .optional(),
  visual: VisualChangeSchema.optional(),
});

export const AddNodeOpSchema = z.object({
  op: z.literal('add_node'),
  semantic: z.object({
    label: z.string(),
    nodeType: z.enum(NODE_TYPES),
  }),
  position: PositionSchema,
});

export const AddEdgeOpSchema = z.object({
  op: z.literal('add_edge'),
  semantic: z.object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
  }),
});

export const DeleteNodeOpSchema = z.object({
  op: z.literal('delete_node'),
  target: z.object({ type: z.literal('node'), oldLabel: z.string() }),
});

export const DeleteEdgeOpSchema = z.object({
  op: z.literal('delete_edge'),
  target: z.object({
    type: z.literal('edge'),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
  }),
});

export const RepositionOpSchema = z.object({
  op: z.literal('reposition'),
  target: z.object({ type: z.literal('node'), oldLabel: z.string() }),
  position: PositionSchema,
});

// ---- 操作序列(整体校验:target 存在性在图遍历层做,此处只做字段级) ----
export const PatchOperationSchema = z.discriminatedUnion('op', [
  ModifyNodeOpSchema,
  ModifyEdgeOpSchema,
  AddNodeOpSchema,
  AddEdgeOpSchema,
  DeleteNodeOpSchema,
  DeleteEdgeOpSchema,
  RepositionOpSchema,
]);

export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const ModifyPatchOutputSchema = z.object({
  operations: z.array(PatchOperationSchema).min(1, '至少包含一个操作'),
});

export type ModifyPatchOutput = z.infer<typeof ModifyPatchOutputSchema>;
