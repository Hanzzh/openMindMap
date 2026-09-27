# 设计文档：节点拖拽移动功能

> **状态**：待实施
> **版本**：v2
> **日期**：2026-07-23
> **相关模块**：`src/interactions/`、`src/renderers/core/`、`src/services/mindmap-service.ts`

---

## 1. 概述

### 1.1 目标
为 openMindMap 插件添加节点拖拽功能，用户可通过拖动节点实现：
- **同级重排序**：改变节点在同一父节点 `children` 数组中的位置
- **跨父节点重挂载**：改变节点的父节点归属

### 1.2 非目标
- 不实现自由布局（节点位置仍由布局算法决定，仅改变数据关系）
- 不实现拖动时自动展开被 hover 的折叠节点（后续增强）
- 不实现视口边缘自动滚动（后续增强）
- 不添加用户设置开关（默认启用）
- 不支持多选拖拽（后续增强）

### 1.3 支持范围
- **桌面端**：鼠标拖拽
- **移动端**：触摸拖拽
- **统一实现**：使用 Pointer Events API

### 1.4 术语表
| 术语 | 含义 |
|---|---|
| **dragNode** | 用户当前正在拖动的节点 |
| **targetNode** | 光标悬停命中的候选目标节点 |
| **DropTarget** | 有效落点描述（含目标、模式、新父节点、插入位置） |
| **Ghost** | 拖拽期间跟随光标的节点 SVG 克隆 |
| **Placeholder** | 指示落点位置的视觉元素（横线或高亮描边） |
| **命中检测** | 根据光标位置计算 DropTarget 的过程 |
| **布局坐标系** | LayoutCalculator 输出的坐标：`x` = 垂直中心, `y` = 水平左边缘（反直觉） |
| **画布坐标系** | SVG 内容组的坐标（受 zoom transform 影响） |

---

## 2. 用户交互设计

### 2.1 触发流程
```
1. 用户在节点上按下（pointerdown）
2. 移动距离超过阈值（桌面 5px / 移动 10px）→ 进入拖拽模式
3. Ghost 节点跟随光标，占位符指示落点
4. 释放（pointerup）→ 执行移动 或 静默取消
```

### 2.2 命中检测规则

将目标节点垂直方向按 30% / 40% / 30% 分区：

```
┌─────────────────────┐
│  上 30%: 插入为前兄弟  │  ← insertBefore
├─────────────────────┤
│                     │
│  中 40%: 作为子节点   │  ← becomeChild（跨父挂载）
│                     │
├─────────────────────┤
│  下 30%: 插入为后兄弟  │  ← insertAfter
└─────────────────────┘
```

不在任何节点 bbox 内 → 无落点，pointerup 时静默取消。

### 2.3 视觉反馈规范

| 元素 | 属性 | 值 |
|---|---|---|
| Ghost | opacity | 0.7 |
| Ghost | pointer-events | none |
| Ghost | filter | `drop-shadow(0 4px 8px rgba(0,0,0,0.2))` |
| 原节点 | opacity | 0.4（拖拽期间） |
| 原节点 | class | 追加 `.dragging-origin` |
| Placeholder（before/after 横线） | stroke | `var(--interactive-accent)` |
| Placeholder（before/after 横线） | stroke-width | 3px |
| Placeholder（before/after 横线） | stroke-linecap | round |
| Placeholder（becomeChild 描边） | stroke | `var(--interactive-accent)` |
| Placeholder（becomeChild 描边） | stroke-width | 3px |
| Placeholder（becomeChild 描边） | stroke-dasharray | `4,3` |
| Placeholder（becomeChild 描边） | fill | none |
| 无落点 Ghost | filter | `hue-rotate(120deg) opacity(0.5)` |
| 光标（桌面） | 拖拽期间 | `grabbing` |
| 光标（桌面） | 悬停可拖节点 | `grab`（可选，避免与 pointer 冲突） |

CSS 类命名遵循现有约定（kebab-case），新增 CSS 写入 `styles.css`。

### 2.4 约束条件

| 场景 | 处理 |
|---|---|
| 拖动根节点 | pointerdown 时忽略，不进入 pending |
| 拖到自己 | 命中检测跳过，视觉标记为无落点 |
| 拖到自己的后代 | 命中检测跳过（`isDescendantOf` 校验） |
| 拖到根节点的上/下半区（insertBefore/insertAfter） | 强制降级为 becomeChild |
| 编辑模式激活时 | pointerdown 直接返回 |
| 未达移动阈值的 pointerup | 走原有 click 逻辑（选择/双击） |
| 拖到画布空白 | 静默取消 |
| 拖到折叠节点上 | 只允许 becomeChild（会成为其隐藏子树的最后一个子节点） |
| 拖动过程中窗口失焦 / Esc / pointercancel | 静默取消并清理 |

---

## 3. 架构设计

### 3.1 模块划分

```
┌────────────────────────────────────────────────────┐
│              RendererCoordinator                    │
│  协调层：模块初始化、drop 处理、保存 root 引用       │
└────┬───────────────────────────────────┬───────────┘
     │                                   │
     ▼                                   ▼
┌────────────────────────┐    ┌────────────────────────┐
│  NodeDragInteraction   │───▶│  DragOverlayRenderer   │
│  拖拽状态机 + 命中检测   │    │  ghost + placeholder   │
└──────┬─────────────────┘    └────────────────────────┘
       │ 命中有效落点
       ▼
┌────────────────────────────────────────────────────┐
│                MindMapService                       │
│    moveNodeToPosition(node, newParent, index)       │
│    数据层：拔出 → 插入 → 修正 level                 │
└──────┬─────────────────────────────────────────────┘
       │ triggerDataUpdate
       ▼
┌────────────────────────────────────────────────────┐
│  main.ts:handleDataUpdated                          │
│    → refreshMindMapLayout()   （重新渲染）         │
│    → saveToMarkdownFile()     （持久化）           │
└────────────────────────────────────────────────────┘
```

### 3.2 与现有模块的关系

| 现有模块 | 关系 | 说明 |
|---|---|---|
| `MouseInteraction` | **平行独立** | 拖拽不复用点击逻辑，独立模块避免耦合；通过 `stopPropagation` 与阈值机制协同 |
| `KeyboardManager` | **透明兼容** | 拖拽中键盘事件仍可到达 (Esc 触发取消) |
| `NodeEditor` | **互斥门控** | 编辑模式与拖拽模式互斥，通过 `syncEditingState` 共享同一门控 |
| `ButtonRenderer` (plus/AI 按钮) | **需处理** | 按钮位于选中节点上方；pointerdown 必须能区分「点击按钮」与「拖动节点」 |
| `MobileToolbar` | **兼容** | 拖拽时应隐藏；拖拽结束后按选中状态恢复 |
| `UndoManager` | **复用** | drop 前调用 `saveSnapshot` |
| `triggerDataUpdate` 链路 | **复用** | 数据变更后自动重渲染 + 存盘 |
| `LayoutCalculator` | **只读消费** | 命中检测读取节点 `x/y` 与尺寸，不修改布局 |
| `TextMeasurer` | **只读消费** | 通过 `getNodeDimensions(depth, text)` 获取节点尺寸 |

---

## 4. 详细模块设计

### 4.1 类型定义

**新增文件**：`src/interactions/NodeDragTypes.ts`

```typescript
import * as d3 from 'd3';
import { MindMapNode } from '../interfaces/mindmap-interfaces';

/**
 * 落点模式
 */
export type DropMode = 'insertBefore' | 'insertAfter' | 'becomeChild';

/**
 * 有效落点描述
 */
export interface DropTarget {
    /** 命中的目标节点 */
    targetNode: d3.HierarchyNode<MindMapNode>;
    /** 落点模式 */
    mode: DropMode;
    /** 移动后节点的新父节点数据 */
    parent: MindMapNode;
    /** 移动后节点在新父节点 children 中的插入位置 */
    insertIndex: number;
}

/**
 * 节点包围盒（画布坐标系）
 */
export interface NodeBBox {
    /** 左边缘 X（画布坐标） */
    x: number;
    /** 上边缘 Y（画布坐标） */
    y: number;
    /** 宽度 */
    width: number;
    /** 高度 */
    height: number;
}

/**
 * 拖拽阶段
 */
export type DragPhase = 'idle' | 'pending' | 'dragging';

/**
 * 拖拽内部状态
 */
export interface DragState {
    phase: DragPhase;
    dragNode: d3.HierarchyNode<MindMapNode> | null;
    pointerId: number | null;
    /** 按下时的屏幕坐标（clientX/Y） */
    startClientX: number;
    startClientY: number;
    /** 当前光标屏幕坐标 */
    currentClientX: number;
    currentClientY: number;
    /** 当前命中的落点 */
    dropTarget: DropTarget | null;
    /** dragNode 后代集合，用于命中检测排除 */
    descendantIds: WeakSet<MindMapNode>;
}
```

### 4.2 回调与配置接口

**新增文件**：`src/interactions/NodeDragCallbacks.ts`

```typescript
import * as d3 from 'd3';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { DropTarget } from './NodeDragTypes';

/**
 * NodeDragInteraction 的回调接口
 */
export interface NodeDragCallbacks {
    /** 拖拽正式开始（越过阈值后） */
    onDragStart: (node: d3.HierarchyNode<MindMapNode>) => void;

    /** 拖拽过程中光标或落点变化 */
    onDragMove: (
        node: d3.HierarchyNode<MindMapNode>,
        clientX: number,
        clientY: number,
        target: DropTarget | null
    ) => void;

    /** 拖拽结束（无论是否有有效落点） */
    onDragEnd: (
        node: d3.HierarchyNode<MindMapNode>,
        target: DropTarget | null
    ) => void;

    /** 拖拽被取消（Esc / pointercancel / 失焦） */
    onDragCancel: (node: d3.HierarchyNode<MindMapNode>) => void;

    /** 获取当前 D3 层次根节点（每次渲染后会变化） */
    getRoot: () => d3.HierarchyNode<MindMapNode> | null;

    /** 获取当前 zoom 变换（用于坐标反算） */
    getZoomTransform: () => d3.ZoomTransform;

    /** 是否处于编辑模式（编辑中禁止拖拽） */
    isEditing: () => boolean;

    /** SVG 元素的 getBoundingClientRect，用于坐标转换 */
    getSvgClientRect: () => DOMRect | null;
}

/**
 * NodeDragInteraction 的配置选项
 */
export interface NodeDragOptions {
    /** 触发拖拽的最小移动像素（default: 桌面 5，移动 10） */
    threshold: number;
    /** Ghost 透明度（default: 0.7） */
    ghostOpacity: number;
    /** 原节点被拖起时的透明度（default: 0.4） */
    originOpacity: number;
    /** 上/下半区占比（default: 0.3，中间区域为 0.4） */
    edgeZoneRatio: number;
}
```

### 4.3 `NodeDragInteraction`（核心）

**新增文件**：`src/interactions/NodeDragInteraction.ts`

#### 4.3.1 生命周期方法
```typescript
export class NodeDragInteraction {
    constructor(
        private callbacks: NodeDragCallbacks,
        private options: NodeDragOptions
    );

    /**
     * 附加交互处理器。每次 render() 后必须重新调用（因为 nodeElements 已被清空重建）。
     */
    attachHandlers(
        svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
        nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
    ): void;

    /**
     * 移除事件监听器（在 render 重建前调用）。
     */
    detachHandlers(): void;

    /**
     * 完全销毁（RendererCoordinator.destroy 时调用）。
     */
    destroy(): void;

    /**
     * 主动取消拖拽（例如外部触发 Esc）。
     */
    cancel(): void;
}
```

#### 4.3.2 事件绑定策略

| 事件 | 目标 | 阶段 | 逻辑 |
|---|---|---|---|
| `pointerdown` | nodeElement | 冒泡 | 校验可拖 → phase=pending，记录起点 |
| `pointermove` | window | 冒泡 | pending：检查阈值 → dragging；dragging：更新光标、命中检测、回调 |
| `pointerup` | window | 冒泡 | dragging：`onDragEnd(target)`；pending：不处理 |
| `pointercancel` | window | 冒泡 | 触发 cancel 流程 |
| `keydown` (Escape) | window | 捕获 | dragging：cancel |
| `blur` | window | 冒泡 | dragging：cancel |

**注意**：window 级监听器在 `attachHandlers` 中注册一次并缓存引用，`detachHandlers` 时移除。避免重复注册。

#### 4.3.3 pointerdown 决策流程

```
pointerdown on nodeElement
  │
  ├─ event.target 是 .plus-button, .ai-suggest-button, 或 button 子元素？
  │     └─ 返回（让按钮点击正常）
  │
  ├─ isEditing() 为 true？
  │     └─ 返回
  │
  ├─ event.button !== 0（非左键）？
  │     └─ 返回
  │
  ├─ node.data.level === 0（根节点）？
  │     └─ 返回
  │
  ├─ 记录 startClientX/Y, pointerId, dragNode
  ├─ phase = pending
  ├─ 收集 dragNode 后代 → descendantIds
  └─ event.stopPropagation()（阻止画布拖拽 mousedown 触发）
```

#### 4.3.4 阈值判定
```typescript
const dx = currentClientX - startClientX;
const dy = currentClientY - startClientY;
if (dx * dx + dy * dy > threshold * threshold) {
    // 进入拖拽模式
}
```

使用平方比较避免 sqrt 计算。

#### 4.3.5 命中检测算法

**核心难点**：坐标系转换。

现有布局坐标系（`LayoutCalculator`）中，节点的 `d.x` 是**垂直中心**，`d.y` 是**水平左边缘**（见 `CoordinateConverter`）。

```typescript
private hitTest(clientX: number, clientY: number): DropTarget | null {
    const root = this.callbacks.getRoot();
    const zoom = this.callbacks.getZoomTransform();
    const svgRect = this.callbacks.getSvgClientRect();
    if (!root || !svgRect) return null;

    // 1. clientXY → SVG 坐标 → 画布内容组坐标（反算 zoom）
    const svgX = clientX - svgRect.left;
    const svgY = clientY - svgRect.top;
    const [layoutCanvasX, layoutCanvasY] = zoom.invert([svgX, svgY]);
    // layoutCanvasX 是水平画布 X，layoutCanvasY 是垂直画布 Y

    // 2. 遍历候选节点（排除 dragNode 及其后代）
    let bestTarget: DropTarget | null = null;
    for (const node of root.descendants()) {
        if (node === this.state.dragNode) continue;
        if (this.state.descendantIds.has(node.data)) continue;

        const bbox = this.computeNodeBBox(node);
        if (!this.pointInBBox(layoutCanvasX, layoutCanvasY, bbox)) continue;

        // 3. 计算 relY 决定模式
        const relY = (layoutCanvasY - bbox.y) / bbox.height;
        let mode: DropMode;
        if (node.data.level === 0) {
            // 根节点只允许 becomeChild
            mode = 'becomeChild';
        } else if (relY < this.options.edgeZoneRatio) {
            mode = 'insertBefore';
        } else if (relY > 1 - this.options.edgeZoneRatio) {
            mode = 'insertAfter';
        } else {
            mode = 'becomeChild';
        }

        // 4. 构造 DropTarget（含新父与 index）
        bestTarget = this.buildDropTarget(node, mode);
        break; // 命中一个即可
    }

    return bestTarget;
}

private computeNodeBBox(node: d3.HierarchyNode<MindMapNode>): NodeBBox {
    const dims = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);
    // 布局 x = 垂直中心，y = 水平左边缘（见 CoordinateConverter）
    return {
        x: node.y,                          // 画布 X（左边缘）
        y: node.x - dims.height / 2,        // 画布 Y（顶边）
        width: dims.width,
        height: dims.height,
    };
}

private buildDropTarget(
    target: d3.HierarchyNode<MindMapNode>,
    mode: DropMode
): DropTarget | null {
    if (mode === 'becomeChild') {
        return {
            targetNode: target,
            mode,
            parent: target.data,
            insertIndex: target.data.children.length,
        };
    }
    // insertBefore / insertAfter 需要 target.parent 存在
    if (!target.parent) return null;
    const parentData = target.parent.data;
    const idx = parentData.children.indexOf(target.data);
    if (idx === -1) return null;
    return {
        targetNode: target,
        mode,
        parent: parentData,
        insertIndex: mode === 'insertBefore' ? idx : idx + 1,
    };
}
```

**注意 `TextMeasurer` 依赖**：`NodeDragInteraction` 需要 TextMeasurer 引用来计算 bbox。通过构造函数注入。

#### 4.3.6 性能考量
- 命中检测在每次 `pointermove` 时执行，对于中等规模脑图（< 500 节点）遍历成本可接受
- 可选优化：将上次命中的 targetNode 优先检测，命中即返回（局部性）
- 后续增强：构建 R-tree 空间索引（超过 1000 节点时）
- Ghost 位置更新使用 `requestAnimationFrame` 节流

---

### 4.4 `DragOverlayRenderer`

**新增文件**：`src/renderers/core/DragOverlayRenderer.ts`

#### 4.4.1 职责
- 创建、更新、销毁 Ghost 节点
- 显示、切换、隐藏占位符（横线 / 高亮描边）
- 管理原节点的"被拖起"视觉状态

#### 4.4.2 DOM 结构
```
<svg>
  <g class="mindmap-content">        ← 现有内容层（受 zoom transform 控制）
    <g class="links">...</g>
    <g class="nodes">...</g>
    <g class="drag-overlay">         ← 新增，与其他内容共享 zoom transform
      <g class="drop-placeholder">
        <line class="drop-line" />          ← insertBefore/insertAfter 时可见
        <rect class="drop-highlight" />     ← becomeChild 时可见
      </g>
      <g class="drag-ghost">                ← 克隆的节点（跟随光标）
        <!-- 从原节点克隆 -->
      </g>
    </g>
  </g>
</svg>
```

**关键决策**：`drag-overlay` 放在 `mindmap-content` 内部（`links` 和 `nodes` 之后），与其他内容共享同一 zoom transform，避免 ghost 位置计算中反复处理缩放。

#### 4.4.3 API 契约

```typescript
export class DragOverlayRenderer {
    constructor(private textMeasurer: TextMeasurer);

    /** 初始化 overlay 层（在 render() 完成后调用） */
    mount(content: d3.Selection<SVGGElement, unknown, null, undefined>): void;

    /** 销毁 overlay 层（在下一次 render() 前调用） */
    unmount(): void;

    /**
     * 显示 Ghost。克隆 sourceNodeElement 的内容。
     * @param sourceNodeElement 源节点的 SVG group 元素
     * @param initialLayoutX 初始画布 X（布局坐标下的水平位置）
     * @param initialLayoutY 初始画布 Y（布局坐标下的垂直位置）
     */
    showGhost(
        sourceNodeElement: SVGGElement,
        initialLayoutX: number,
        initialLayoutY: number,
        opacity: number
    ): void;

    /**
     * 更新 Ghost 位置（画布坐标）。
     */
    updateGhost(layoutX: number, layoutY: number): void;

    /**
     * 设置 Ghost 为"无落点"视觉状态。
     */
    setGhostInvalid(invalid: boolean): void;

    hideGhost(): void;

    /**
     * 显示占位符。
     * @param target 有效落点
     * @param targetBBox 目标节点包围盒（画布坐标）
     */
    showPlaceholder(target: DropTarget, targetBBox: NodeBBox): void;

    hidePlaceholder(): void;

    /**
     * 给原节点添加 .dragging-origin class + 降低透明度。
     */
    markOriginAsDragging(nodeElement: SVGGElement, opacity: number): void;

    unmarkOrigin(): void;

    destroy(): void;
}
```

#### 4.4.4 占位符几何计算

**insertBefore**：
- 横线位于 `targetBBox` 顶边上方 4px
- 起点 X = `targetBBox.x`，终点 X = `targetBBox.x + targetBBox.width`
- Y = `targetBBox.y - 4`

**insertAfter**：
- 横线位于 `targetBBox` 底边下方 4px
- 同 X 范围，Y = `targetBBox.y + targetBBox.height + 4`

**becomeChild**：
- 描边矩形完全覆盖 `targetBBox`，加 2px 外扩
- X = `targetBBox.x - 2`, Y = `targetBBox.y - 2`
- width = `targetBBox.width + 4`, height = `targetBBox.height + 4`
- rx/ry = 6（与节点圆角一致）

---

### 4.5 `MindMapService` 扩展

**修改文件**：`src/services/mindmap-service.ts`（新增方法）

#### 4.5.1 方法签名
```typescript
/**
 * 将节点移动到新位置（同级重排 或 跨父挂载）。
 *
 * @param node 要移动的节点
 * @param newParent 移动后的新父节点
 * @param insertIndex 移动后在 newParent.children 中的位置
 * @returns 是否成功
 */
moveNodeToPosition(
    node: MindMapNode,
    newParent: MindMapNode,
    insertIndex: number
): boolean
```

#### 4.5.2 执行步骤
```
1. 前置校验：
   - node.level === 0 → 返回 false（不可移动根节点）
   - newParent === node → 返回 false
   - isDescendantOf(newParent, node) 为 true → 返回 false（防循环）
   - node.parent === null → 返回 false
   - insertIndex 越界 → clamp 到 [0, newParent.children.length]

2. 从原父节点拔出：
   const oldParent = node.parent;
   const oldIndex = oldParent.children.indexOf(node);
   if (oldIndex === -1) return false;
   oldParent.children.splice(oldIndex, 1);

3. 同父节点重排的 index 校正：
   if (oldParent === newParent && oldIndex < insertIndex) {
       insertIndex--;
   }

4. 同位置短路（性能优化，避免无谓的存盘）：
   if (oldParent === newParent && oldIndex === insertIndex) {
       // 撤销拔出（放回原位）
       oldParent.children.splice(oldIndex, 0, node);
       return false;
   }

5. 插入新父节点：
   newParent.children.splice(insertIndex, 0, node);
   node.parent = newParent;

6. 递归修正 level：
   updateLevelsRecursively(node, newParent.level + 1);

7. 触发日志（Logger.debug）:
   'MindMapService', 'moveNodeToPosition',
   { nodeText, oldParentText, newParentText, oldIndex, insertIndex }

8. 返回 true
```

#### 4.5.3 辅助方法
```typescript
/**
 * 判断 candidate 是否为 ancestor 的后代（或 ancestor 本身）。
 */
private isDescendantOf(candidate: MindMapNode, ancestor: MindMapNode): boolean {
    if (candidate === ancestor) return true;
    for (const child of ancestor.children) {
        if (this.isDescendantOf(candidate, child)) return true;
    }
    return false;
}

/**
 * 递归修正 node 及其所有后代的 level。
 */
private updateLevelsRecursively(node: MindMapNode, newLevel: number): void {
    node.level = newLevel;
    for (const child of node.children) {
        this.updateLevelsRecursively(child, newLevel + 1);
    }
}
```

---

### 4.6 `RendererCoordinator` 修改

**修改文件**：`src/renderers/renderer-coordinator.ts`

#### 4.6.1 新增字段
```typescript
private dragInteraction: NodeDragInteraction;
private dragOverlayRenderer: DragOverlayRenderer;
private currentRoot: d3.HierarchyNode<MindMapNode> | null = null;
```

#### 4.6.2 初始化（`initializeFeatureModules` 末尾追加）
```typescript
// 7. Drag overlay renderer + drag interaction
this.dragOverlayRenderer = new DragOverlayRenderer(this.textMeasurer);

this.dragInteraction = new NodeDragInteraction(
    this.textMeasurer,
    {
        onDragStart: (node) => this.handleDragStart(node),
        onDragMove: (node, cx, cy, target) => this.handleDragMove(node, cx, cy, target),
        onDragEnd: (node, target) => this.handleDragEnd(node, target),
        onDragCancel: (node) => this.handleDragCancel(node),
        getRoot: () => this.currentRoot,
        getZoomTransform: () => this.currentZoomTransform,
        isEditing: () => this.nodeEditor.isEditing(),
        getSvgClientRect: () => this.currentSvg?.node()?.getBoundingClientRect() ?? null,
    },
    {
        threshold: this.config.isMobile ? 10 : 5,
        ghostOpacity: 0.7,
        originOpacity: 0.4,
        edgeZoneRatio: 0.3,
    }
);
```

#### 4.6.3 挂载点

- **`render()` 内**（root 计算完成后）：`this.currentRoot = root;`
- **`renderNodes()` 内**（`renderer-coordinator.ts:512`）：在渲染完 links + nodes 后，`mount(dragOverlayRenderer)`
- **`attachInteractionHandlers()` 内**（`renderer-coordinator.ts:574`）：`this.dragInteraction.attachHandlers(this.currentSvg, nodeElements);`
- **每次重新 render 前**：先调用 `dragInteraction.detachHandlers()` + `dragOverlayRenderer.unmount()`

#### 4.6.4 新增处理方法

```typescript
private handleDragStart(node: d3.HierarchyNode<MindMapNode>): void {
    // 1. 门控：禁用画布交互
    this.canvasInteractionEnabled = false;
    this.interactionManager.syncEditingState(true);

    // 2. 隐藏移动端 toolbar（拖拽时不显示按钮）
    if (this.config.isMobile && this.mobileToolbar) {
        this.mobileToolbar.hide?.();
    }

    // 3. 显示 ghost 与原节点标记
    const nodeEl = this.findNodeElementDOM(node);
    if (!nodeEl) return;
    this.dragOverlayRenderer.showGhost(
        nodeEl,
        node.y,                             // 画布 X（左边缘）
        node.x - this.textMeasurer.getNodeDimensions(node.depth, node.data.text).height / 2,
        0.7
    );
    this.dragOverlayRenderer.markOriginAsDragging(nodeEl, 0.4);

    Logger.getInstance().debug('RendererCoordinator', 'handleDragStart', {
        nodeText: node.data.text,
    });
}

private handleDragMove(
    node: d3.HierarchyNode<MindMapNode>,
    clientX: number,
    clientY: number,
    target: DropTarget | null
): void {
    // 1. 转换光标到画布坐标，更新 ghost 位置
    const rect = this.currentSvg?.node()?.getBoundingClientRect();
    if (!rect) return;
    const [cx, cy] = this.currentZoomTransform.invert([
        clientX - rect.left,
        clientY - rect.top,
    ]);
    const dims = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);
    // ghost 中心跟随光标
    this.dragOverlayRenderer.updateGhost(cx - dims.width / 2, cy - dims.height / 2);

    // 2. 更新占位符
    if (target) {
        const bbox = this.computeNodeBBox(target.targetNode);
        this.dragOverlayRenderer.showPlaceholder(target, bbox);
        this.dragOverlayRenderer.setGhostInvalid(false);
    } else {
        this.dragOverlayRenderer.hidePlaceholder();
        this.dragOverlayRenderer.setGhostInvalid(true);
    }
}

private handleDragEnd(
    node: d3.HierarchyNode<MindMapNode>,
    target: DropTarget | null
): void {
    // 1. 清理 overlay + 恢复门控
    this.dragOverlayRenderer.hideGhost();
    this.dragOverlayRenderer.hidePlaceholder();
    this.dragOverlayRenderer.unmarkOrigin();
    this.canvasInteractionEnabled = true;
    this.interactionManager.syncEditingState(false);

    if (!target) {
        Logger.getInstance().debug('RendererCoordinator', 'handleDragEnd: no target');
        return;
    }

    // 2. 保存 undo 快照
    if (this.currentData) {
        this.undoManager.saveSnapshot(this.currentData);
    }

    // 3. 执行数据移动
    const ok = this.mindMapService.moveNodeToPosition(
        node.data,
        target.parent,
        target.insertIndex
    );

    // 4. 成功则刷新
    if (ok) {
        this.clearSelection();
        this.triggerDataUpdate();
    } else {
        Logger.getInstance().warn('RendererCoordinator', 'moveNodeToPosition returned false');
    }
}

private handleDragCancel(node: d3.HierarchyNode<MindMapNode>): void {
    this.dragOverlayRenderer.hideGhost();
    this.dragOverlayRenderer.hidePlaceholder();
    this.dragOverlayRenderer.unmarkOrigin();
    this.canvasInteractionEnabled = true;
    this.interactionManager.syncEditingState(false);
}

private findNodeElementDOM(node: d3.HierarchyNode<MindMapNode>): SVGGElement | null {
    const el = d3.selectAll<SVGGElement, d3.HierarchyNode<MindMapNode>>('.nodes g')
        .filter((d) => d === node)
        .node();
    return el ?? null;
}

private computeNodeBBox(node: d3.HierarchyNode<MindMapNode>): NodeBBox {
    const dims = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);
    return {
        x: node.y,
        y: node.x - dims.height / 2,
        width: dims.width,
        height: dims.height,
    };
}
```

#### 4.6.5 销毁（`destroy()` 内）
```typescript
this.dragInteraction.destroy();
this.dragOverlayRenderer.destroy();
```

---

### 4.7 `MouseInteraction` 微调

**修改文件**：`src/interactions/MouseInteraction.ts`

**必要修改**：在 `attachCanvasDragHandlers` 的 `mousedown` 判定中，追加对节点元素的检测，避免节点上的按下动作被误判为画布拖拽。

现有代码（`MouseInteraction.ts:112-127`）已跳过 `contenteditable` 元素，需追加：

```typescript
svg.on("mousedown", (event: MouseEvent) => {
    const target = event.target as HTMLElement;

    // 现有：跳过 contenteditable
    if (target.contentEditable === "true" || target.closest('[contenteditable="true"]')) {
        return;
    }

    // 【新增】跳过节点相关元素，交给 NodeDragInteraction 处理
    if (target.closest('.nodes g') || target.closest('.node-rect')) {
        return;
    }

    // 现有：画布拖拽启动
    if (event.button === 0 && this.isCanvasInteractionEnabled()) {
        isDragging = true;
        ...
    }
});
```

**备选方案**：由 `NodeDragInteraction.pointerdown` 调用 `event.stopPropagation()` 即可自动阻止画布 `mousedown` 触发。**推荐备选方案**（更简洁），此处 MouseInteraction 无需修改。

---

### 4.8 `InteractionManager` 语义扩展

**修改文件**：`src/interactions/interaction-manager.ts`

无需新增字段。复用现有 `syncEditingState(true)` 表达"拖拽期间禁用画布交互"。语义合理性：拖拽与编辑都属于「排他性节点操作」，共享同一门控。

若后续需要区分「编辑」与「拖拽」的其他行为（例如某快捷键仅编辑生效），再拆分为独立状态。

---

## 5. 数据流

### 5.1 完整拖拽时序
```
用户按下节点
  └─ NodeDragInteraction.pointerdown
       ├─ 校验（非根、非编辑、非按钮）
       ├─ state.phase = 'pending'
       └─ event.stopPropagation()  ← 阻止 MouseInteraction 的 mousedown

用户移动 (dx² + dy² > threshold²)
  └─ NodeDragInteraction.pointermove
       ├─ state.phase = 'dragging'
       └─ callbacks.onDragStart(node)
            └─ RendererCoordinator.handleDragStart
                 ├─ canvasInteractionEnabled = false
                 ├─ interactionManager.syncEditingState(true)
                 ├─ mobileToolbar.hide()
                 ├─ dragOverlayRenderer.showGhost()
                 └─ dragOverlayRenderer.markOriginAsDragging()

用户持续移动（每帧 rAF 节流）
  └─ NodeDragInteraction.pointermove
       ├─ hitTest(clientX, clientY) → dropTarget
       └─ callbacks.onDragMove(node, cx, cy, dropTarget)
            └─ RendererCoordinator.handleDragMove
                 ├─ dragOverlayRenderer.updateGhost(x, y)
                 └─ dragOverlayRenderer.showPlaceholder / hidePlaceholder

用户释放
  └─ NodeDragInteraction.pointerup
       └─ callbacks.onDragEnd(node, dropTarget)
            └─ RendererCoordinator.handleDragEnd
                 ├─ 清理 overlay + 恢复门控
                 └─ if (dropTarget):
                      ├─ undoManager.saveSnapshot()
                      ├─ mindMapService.moveNodeToPosition()
                      └─ triggerDataUpdate()
                           └─ onDataUpdated
                                └─ main.ts:handleDataUpdated
                                     ├─ refreshMindMapLayout()   ← 重新 render
                                     └─ saveToMarkdownFile()      ← 持久化
```

### 5.2 事件状态机
```
        pointerdown (可拖节点)
              │
              ▼
    ┌───────────────────┐
    │       idle         │◄──────────────────────────┐
    └───────────────────┘                            │
              │                                      │
              ▼                                      │
    ┌───────────────────┐    未超阈值 pointerup       │
    │      pending       │──────────────────────────┤
    └───────────────────┘                            │
              │                                      │
              │ pointermove 超阈值                    │
              ▼                                      │
    ┌───────────────────┐                            │
    │     dragging       │                            │
    └───────────────────┘                            │
              │                                      │
      ┌───────┼───────────┬───────────┐              │
      ▼       ▼           ▼           ▼              │
   pointerup pointercancel Esc     window.blur       │
      │       │           │           │              │
      └───────┴───────────┴───────────┴──────────────┘
```

---

## 6. 冲突门控矩阵

| 场景 | canvasInteractionEnabled | 节点 click | D3 zoom | 拖拽 | 移动 toolbar |
|---|---|---|---|---|---|
| 空闲 | true | 允许 | 允许 | 允许启动 | 按选中状态 |
| pending（未越阈值） | true（未变） | 待定 | 允许 | 进行中 | 不变 |
| dragging | false | 阻断 | 阻断 | 进行中 | 隐藏 |
| editing | false | 特殊处理 | 阻断 | 阻断 | 隐藏 |

**约束保证**：
- 现有 `setupZoom.filter`（`renderer-coordinator.ts:526`）已根据 `canvasInteractionEnabled` 阻断 zoom
- 现有 `MouseInteraction.isCanvasInteractionEnabled` 通过回调链接到 `InteractionManager.state.editingState.isEditing`
- 通过 `syncEditingState(true)` 复用同一门控

---

## 7. 边界情况处理

| 边界情况 | 处理策略 |
|---|---|
| 拖动根节点 | pointerdown 直接返回，不进入 pending |
| 拖到自身 | 命中检测跳过 dragNode |
| 拖到自身后代 | `descendantIds` 集合排除 |
| 拖到根节点的上/下半区 | 命中检测强制降级为 becomeChild |
| 折叠节点内部拖动 | 折叠节点的子孙不在 `root.descendants()` 输出中 |
| 拖到折叠节点上 | 允许 becomeChild，会成为其隐藏子树的最后一个子节点（re-render 后仍折叠） |
| 拖到画布空白 | dropTarget = null，pointerup 时静默取消 |
| 拖动过程中窗口失焦 | 监听 `window.blur`，触发 cancel |
| 拖到同父同位置 | service 层短路返回 false，避免无谓存盘 |
| 拖到 pending 状态时页面刷新 | destroy 阶段确保 window 监听器被移除 |
| Zoom 变化中的命中检测 | 通过 `zoomTransform.invert` 反算光标画布坐标 |
| 点击 plus/AI 按钮 | pointerdown 时检测 `event.target.closest('.plus-button-group, .ai-suggest-button-group')`，直接返回 |
| iOS 长按触发系统菜单 | pointerdown 时 `event.preventDefault()` 阻止默认 |
| 触摸滚动误触发拖拽 | 阈值 10px 缓冲；且 `event.preventDefault()` 阻止 scroll |

---

## 8. 撤销/重做

- `handleDragEnd` 在调用 `moveNodeToPosition` 前调用 `undoManager.saveSnapshot(currentData)`
- 完全复用现有 undo/redo 链路（Ctrl+Z / Ctrl+Shift+Z）
- 撤销后节点回到原位置（原父 + 原 index），level 也自动恢复
- 无需新增代码

---

## 9. 持久化

- `triggerDataUpdate` → `onDataUpdated` → `main.ts:handleDataUpdated`（`main.ts:702`）
- 现有链路会调用 `saveToMarkdownFile(filePath, rootNode)` 序列化整棵树为 markdown 并写回文件
- Markdown 格式的层级由 `level`（缩进）表达，因此 level 更新后序列化天然正确
- 无需新增持久化代码

---

## 10. 无障碍访问（A11y）

- 拖拽期间保留原节点的 `role="button"` 与 `aria-label`
- Ghost 节点添加 `aria-hidden="true"`，避免屏幕阅读器重复朗读
- 键盘辅助移动**不在本次范围**（后续增强：Alt+↑↓ 同级重排、Alt+Shift+↑↓ 跨层移动）
- 触摸辅助功能：不阻止 VoiceOver 手势（仅在明确 pointerdown 后阻止 default）

---

## 11. 国际化（i18n）

本功能无用户可见文案（无按钮、无提示、无菜单项）。

**唯一例外**：如果未来添加错误提示（例如「无法移动根节点」），需在 `src/i18n/en.ts` 和 `src/i18n/zh.ts` 的 `notices` 分组添加：
- `cannotDragRoot`（英）/ `无法拖动根节点`（中）
- `cannotDropOnSelf`（英）/ `不能拖到自身或子节点上`（中）

本次实现选择**静默失败**（无 Notice 提示），避免打断用户操作。

---

## 12. CSS 样式

**修改文件**：`styles.css`（追加）

```css
/* 拖拽期间原节点视觉 */
.mindmap-content .nodes g.dragging-origin .node-rect {
    opacity: 0.4;
    transition: opacity 0.15s ease;
}

/* Ghost 节点 */
.drag-ghost {
    pointer-events: none;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
    transition: opacity 0.1s ease;
}

.drag-ghost.invalid {
    filter: hue-rotate(120deg) opacity(0.5);
}

/* 占位符：兄弟插入横线 */
.drop-line {
    stroke: var(--interactive-accent, #2972f4);
    stroke-width: 3;
    stroke-linecap: round;
    pointer-events: none;
}

/* 占位符：变为子节点的高亮描边 */
.drop-highlight {
    fill: none;
    stroke: var(--interactive-accent, #2972f4);
    stroke-width: 3;
    stroke-dasharray: 4, 3;
    pointer-events: none;
}

/* 拖拽期间禁用文本选择 */
.mindmap-content.dragging,
.mindmap-content.dragging * {
    user-select: none;
    -webkit-user-select: none;
}
```

---

## 13. 日志规范

统一通过 `Logger.getInstance()` 打印，模块名使用 `NodeDragInteraction` 和 `DragOverlayRenderer`。

| 时机 | 级别 | 内容 |
|---|---|---|
| pointerdown 决策为跳过 | debug | 原因（root / editing / button / not-left） |
| 进入 dragging | info | { nodeText, level } |
| 命中检测更新 | debug（节流） | { targetText, mode } |
| pointerup 无落点 | debug | 'cancel: no target' |
| moveNodeToPosition 成功 | info | { from, to, mode } |
| moveNodeToPosition 失败 | warn | { reason } |
| 拖拽取消（Esc/blur） | debug | { source } |

---

## 14. 文件清单

### 14.1 新增（4 个文件）
| 文件 | 行数估算 | 职责 |
|---|---|---|
| `src/interactions/NodeDragTypes.ts` | ~60 | 类型定义（DropTarget、DragState 等） |
| `src/interactions/NodeDragCallbacks.ts` | ~50 | 回调与配置接口 |
| `src/interactions/NodeDragInteraction.ts` | ~350 | 拖拽状态机 + 命中检测 |
| `src/renderers/core/DragOverlayRenderer.ts` | ~220 | ghost + placeholder 渲染 |

### 14.2 修改（3 个文件）
| 文件 | 修改点 |
|---|---|
| `src/services/mindmap-service.ts` | +`moveNodeToPosition` + 2 个私有辅助方法（~70 行） |
| `src/renderers/renderer-coordinator.ts` | 初始化、attach/detach、drag handlers、bbox 计算、destroy（~120 行） |
| `styles.css` | 追加拖拽相关 CSS（~40 行） |

### 14.3 不修改
- 配置文件（不添加设置开关）
- `interfaces/mindmap-interfaces.ts`（相关类型定义在 `NodeDragTypes.ts` 内）
- i18n 文件（本次无用户可见文案）
- `MouseInteraction.ts`（通过 stopPropagation 解决冲突）

---

## 15. 测试策略

### 15.1 单元测试（`test:unit`）
针对 `MindMapService.moveNodeToPosition`：
- ✅ 同父上移：oldIndex > newIndex
- ✅ 同父下移：oldIndex < newIndex（index 校正）
- ✅ 跨父挂载：child 转移到另一子树
- ✅ 拒绝移动根节点
- ✅ 拒绝移动到自身
- ✅ 拒绝移动到自身后代
- ✅ 同父同位置短路
- ✅ 移动嵌套子树后 level 递归修正
- ✅ insertIndex 越界 clamp

### 15.2 手动交互测试
桌面：
- [ ] 拖动子节点到同父下方 → 成为后兄弟
- [ ] 拖动子节点到同父上方 → 成为前兄弟
- [ ] 拖动到其他节点中间 → 成为其子节点
- [ ] 拖动根节点 → 无响应
- [ ] 拖到自己 → 无响应（视觉：ghost 变灰）
- [ ] 拖到自己的子孙 → 无响应
- [ ] 拖到空白 → 静默取消
- [ ] 未越过阈值 pointerup → 触发单击选择
- [ ] 快速双击 → 进入编辑（不误触拖拽）
- [ ] 编辑模式下按节点 → 不触发拖拽
- [ ] 点击选中节点上的 plus/AI 按钮 → 不触发拖拽
- [ ] 拖拽期间 Ctrl+滚轮 → 不缩放
- [ ] 拖拽期间画布不被平移
- [ ] Esc 键取消拖拽
- [ ] 切换到其他应用（失焦）→ 取消拖拽

移动端（iPad / Android）：
- [ ] 长按+拖动可移动节点
- [ ] 触摸不小心滚动不误触发拖拽
- [ ] 双指缩放不触发拖拽
- [ ] 拖拽期间 mobile toolbar 隐藏

数据完整性：
- [ ] 拖动后 markdown 文件正确更新
- [ ] Ctrl+Z 撤销回到拖动前状态
- [ ] Ctrl+Shift+Z 重做恢复移动后状态
- [ ] 移动嵌套子树（带 3+ 层子节点）时 level 全部正确更新
- [ ] 拖动到折叠节点内部后再展开 → 结构正确

### 15.3 构建验证
- [ ] `npm run build` 通过（tsc 类型检查 + esbuild 打包）
- [ ] `npm run build:core && npm run test` 通过（overlap 验证不变）

---

## 16. 实施顺序（Rollout Plan）

按依赖顺序实施：

1. **类型与服务层**
   - 创建 `NodeDragTypes.ts`、`NodeDragCallbacks.ts`
   - 在 `MindMapService` 添加 `moveNodeToPosition` + 单元测试

2. **视觉层**
   - 实现 `DragOverlayRenderer`
   - 追加 CSS

3. **交互层**
   - 实现 `NodeDragInteraction`（先实现桌面 mouse，再验证触摸）

4. **协调层集成**
   - `RendererCoordinator` 增加初始化、attach/detach、handle* 方法
   - 关联 render/destroy 生命周期

5. **端到端验证**
   - 桌面全套手动测试
   - 移动端验证
   - 构建 + 单元测试

6. **回归验证**
   - 单击选择、双击编辑、按钮点击、undo/redo、canvas 平移/缩放
   - 键盘快捷键 (Tab/Enter/Delete)
   - 剪贴板操作

---

## 17. 后续增强（不在本次范围）

- 拖到折叠节点上悬停 500ms 自动展开
- 拖到视口边缘时自动滚动
- 移动端触觉反馈 `navigator.vibrate(50)`
- 拖拽多选（Shift+Click 选中多个后一起拖）
- 键盘辅助移动（Alt+↑↓ 同级重排、Alt+Shift+↑↓ 跨层移动）
- R-tree 空间索引（超过 1000 节点时优化命中检测）
- 拖拽期间显示预览布局（虚线渲染未来位置）

---

## 18. 风险与备选方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| 移动端 iOS 系统手势冲突 | 无法拖动 | pointerdown 时 `preventDefault`；测试真机确认 |
| Ghost 位置偏移（zoom 反算错误） | 视觉与光标不同步 | 严格通过 `zoomTransform.invert` 转换；单元测试验证 |
| 大脑图（>500 节点）hit-test 卡顿 | 拖拽掉帧 | pointermove 用 rAF 节流；命中优先检测上次命中节点 |
| pointer events 在旧版 Obsidian 不可用 | 功能不可用 | Obsidian 最低支持 0.15.0，pointer events 已广泛可用；如需兼容可降级到 mouse+touch |
| 拖到折叠节点内部造成用户困惑 | UX 问题 | 折叠节点作为 becomeChild 目标时高亮更明显；后续增强：hover 自动展开 |
| 与 D3 zoom `filter` 冲突导致画布仍在移动 | 拖拽期间画布错位 | `canvasInteractionEnabled = false` 会让 zoom filter 返回 false，阻断所有 zoom 事件 |

---

## 19. 验收标准

功能视为完成需满足：

1. ✅ 桌面鼠标可完成同级重排 + 跨父挂载
2. ✅ 移动端触摸可完成同级重排 + 跨父挂载
3. ✅ 拖拽视觉反馈符合 §2.3 规范
4. ✅ 所有约束条件（§2.4）正确处理
5. ✅ Undo/Redo 正常工作
6. ✅ Markdown 文件正确持久化
7. ✅ 单元测试全部通过
8. ✅ 手动交互测试清单全部通过
9. ✅ `npm run build` 无错误无警告
10. ✅ 无回归：现有点击、编辑、快捷键、缩放、平移功能正常

---

**文档结束**
