# Interaction 模块设计

> **范围**：`src/interactions/*`
> **模式**：Manager + Callback；Early Branching #2
> **依赖**：D3 zoom、Pointer/Mouse/Keyboard 原生事件

---

## 1. 模块职责

- 处理**鼠标**与**键盘**两条输入通道，桥接为语义化事件（`onNodeSelected`、`onAddChildNode` 等）。
- 集中管理选中 / 悬停 / 编辑状态。
- 提供画布交互门禁（`canvasInteractionEnabled`）。

## 2. 分层

```
InteractionManager   (Coordinator, 唯一入口)
    ├── MouseInteraction     ── 单/双击/悬停/画布拖拽/画布点击
    └── KeyboardManager      ── Tab/Enter/Delete/剪贴板/Undo/Redo 全局路由

(遗留)
DesktopInteraction / MobileInteraction  ── Phase 1 遗留包装
    └── D3InteractionHandler            ── 旧交互实现，主流程未使用
```

## 3. `InteractionManager`

### 3.1 API

```typescript
class InteractionManager {
    constructor(
        config: MindMapConfig,
        renderCallbacks?: RenderCallbacks,
        isActiveView?: () => boolean,
    );

    attachHandlers(svg, nodeElements): void;
    selectNode(node) / hoverNode(node) / clearSelection();
    enterEditing(node, element) / exitEditing();
    syncEditingState(isEditing): void;
    isCanvasInteractionEnabled(): boolean;
    getMouseInteraction() / getKeyboardManager();
    destroy();
}
```

### 3.2 内部状态

```typescript
interface InteractionState {
    selectedNode: HierarchyNode<MindMapNode> | null;
    hoveredNode:  HierarchyNode<MindMapNode> | null;
    editingState: EditingState;   // 与 Coordinator/NodeEditor/TextRenderer 共享同一引用
}
```

### 3.3 `RenderCallbacks`（对外语义化事件）

由 `RendererCoordinator` 传入：

```typescript
{
    onNodeSelected, onNodeHovered, onNodeLeft, onSelectionCleared,
    onNodeDoubleClicked,
    onAddChildNode, onAddSiblingNode, onDeleteNode,
    onCopyNode, onCutNode, onPasteToNode,
    onExitEditMode, onUndo, onRedo,
}
```

### 3.4 事件桥接

| 底层事件 | 桥接方法 | 转发 |
|---|---|---|
| MouseInteraction.onNodeSelect | handleNodeSelect | onNodeSelected |
| MouseInteraction.onNodeDoubleClick | handleNodeDoubleClick | onNodeDoubleClicked |
| MouseInteraction.onNodeHover | handleNodeHover | onNodeHovered |
| MouseInteraction.onNodeLeave | handleNodeLeave | onNodeLeft |
| MouseInteraction.onCanvasClick | handleCanvasClick | 编辑中→onExitEditMode，否则→onSelectionCleared |
| KeyboardManager.onTab | — | onAddChildNode |
| KeyboardManager.onEnter | — | onAddSiblingNode |
| KeyboardManager.onDelete | — | onDeleteNode |
| KeyboardManager.onCopy/Cut/Paste | — | onCopyNode/onCutNode/onPasteToNode |
| KeyboardManager.onUndo/Redo | — | onUndo/onRedo |

## 4. `MouseInteraction`

### 4.1 API

```typescript
class MouseInteraction {
    constructor(callbacks: MouseInteractionCallbacks);

    attachNodeClickHandlers(nodeElements);
    attachNodeHoverHandlers(nodeElements);
    attachCanvasDragHandlers(svg);
    attachCanvasClickHandler(svg);
    clearSelection();
    destroy();
}
```

### 4.2 `MouseInteractionCallbacks`（低耦合）

```typescript
{
    onNodeSelect?, onNodeDoubleClick?, onNodeHover?, onNodeLeave?,
    onCanvasClick?, onCanvasDrag?(dx, dy),
    isCanvasInteractionEnabled?(),
    isEditing?(), getEditingNode?(),
    onCanvasInteractionChanged?(enabled),
}
```

### 4.3 关键算法：双击判定

```
isDoubleClick = (now - lastClickTime < 300ms) && (clickNode === node)
```

- **双击命中**：清标志、`stopPropagation`、触发 `onNodeDoubleClick`。**不 `preventDefault`** — 保留浏览器光标定位。
- **单击**：不使用延迟；立即 `performNodeSelection`；300ms 后清 timeout。

### 4.4 选择流程 `performNodeSelection`

```
1. 若当前正在编辑同一节点 → 忽略（避免编辑被打断）
   若编辑其他节点 → 允许（触发 blur 保存）
2. 清除旧选中：data.selected=false, .selected-rect, .plus-button-group, .ai-suggest-button-group
3. 清除当前节点 hover 状态
4. node.data.selected = true, 追加 .selected-rect class
5. 触发 onNodeSelect(node)
```

### 4.5 画布拖拽

```
mousedown:
    if target.contentEditable==="true" → skip（让编辑器处理）
    if left button && isCanvasInteractionEnabled() → 启动
        记录起点，光标 grabbing
mousemove:
    dx = e.clientX - startX; dy = e.clientY - startY
    onCanvasDrag(dx, dy)
mouseup / mouseleave:
    重置
```

### 4.6 画布点击 → 清选

- 捕获阶段监听 `click`。
- `isNodeElement(target)` 判定：`g.node`, `.node-rect`, `.node-text-layer`, `foreignobject`, `div`, `g.node-group`。
- 非节点 → `clearSelection()` + `onCanvasClick()`。

## 5. `KeyboardManager`

### 5.1 API

```typescript
class KeyboardManager {
    constructor(config: KeyboardManagerConfig, handlers: KeyboardHandlers);

    attachGlobalListener(): void;
    removeGlobalKeyboardListener(): void;
    destroy(): void;
}
```

### 5.2 `KeyboardManagerConfig`

```typescript
{
    config?: MindMapConfig;              // 用于判断 isMobile
    isEditing: () => boolean;
    getSelectedNode: () => HierarchyNode<MindMapNode> | null;
    isActiveView?: () => boolean;        // 隔离多视图共存
}
```

### 5.3 路由决策

**前置门禁**：

```
1. isActiveView?.() === false → 放行（不拦截其他视图）
2. isEditing() === true:
     Ctrl/Cmd+C/X/V → 放行（浏览器处理选区文本）
     其他快捷键     → 静默阻断（return）
```

**主路由**（非编辑）：

| 按键 | 处理 | 移动端 |
|---|---|---|
| Tab | preventDefault → onTab(sel) | 启用 |
| Delete/Del | preventDefault → onDelete(sel) | 启用 |
| Enter | preventDefault → onEnter(sel)；根节点(level=0)静默拒绝 | 启用 |
| Ctrl/Cmd+C | onCopy(sel) | **禁用**（`disableMobileShortcuts=true`）|
| Ctrl/Cmd+X | onCut(sel) | 禁用 |
| Ctrl/Cmd+V | onPaste(sel) | 禁用 |
| Ctrl/Cmd+Z | onUndo() | 禁用 |
| Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z | onRedo() | 禁用 |

**静默失败**：无 selectedNode 时 handler 直接 return。剪贴板 handler 返回 Promise，使用 `void` 抛弃。

### 5.4 移动端禁用理由

移动键盘不常见；虚拟键盘 Ctrl 键难以触发；避免与 IME 冲突。

## 6. 遗留：`DesktopInteraction` / `MobileInteraction`

Phase 1 的包装类，内部委托 `handlers/interaction-handler.D3InteractionHandler`。**主流程未使用**（`RendererCoordinator` 走 `InteractionManager` 路径）。

保留原因：
- `MobileInteraction` 的 `detectTouchEvent()` 逻辑（`TouchEvent` / `pointerType` / `event.type`）为将来独立触摸交互预留。
- 可能作为 Phase 3+ 完整触摸手势（pinch/long-press）的落点。

**如需清理**：先确认 `RendererCoordinator` 无引用后删除；避免破坏其他子类扩展。

## 7. 门禁矩阵

| 场景 | canvasInteractionEnabled | 节点点击 | Zoom/Pan | 键盘快捷键 | 编辑 |
|---|---|---|---|---|---|
| 空闲 | true | ✅ | ✅ | ✅（含 Ctrl+C/X/V 由 Mouse 层处理选中节点）| — |
| 编辑中 | false | 同节点忽略；跨节点触发 blur 保存 | ❌（zoom filter 拦截）| Ctrl+C/X/V 放行；其他阻断 | ✅ |
| （规划）拖拽中 | false | ❌ | ❌ | Esc 取消 | ❌ |

**Zoom filter 实现**：`RendererCoordinator.setupZoom` 中 `.filter()` 检查 `canvasInteractionEnabled` 与 target 是否 contenteditable。

## 8. 关键设计权衡

| 问题 | 现方案 | 备选 |
|---|---|---|
| 单击延迟 vs 立即 | 立即触发选择 + 300ms 双击窗口回收 | 单击延迟 250ms（旧方案，已废弃）|
| 触摸判定 | 未启用（Mobile 使用与桌面相同代码路径 + MobileToolbar 补 UI）| 独立 pointer events 路径 |
| 键盘 Ctrl 前缀 | metaKey || ctrlKey 均接受 | 分别绑定 |
| 多视图键盘冲突 | `isActiveView` 门禁 | 使用 focus + tabindex |
| 编辑态门禁散点 | 三处判断（canvasInteractionEnabled / isEditing / target contenteditable）| 抽出统一 GateManager |

## 9. 演进空间

- 引入 `PointerInteraction` 统一鼠标 + 触摸，实现拖拽移动节点（见 [节点拖拽设计](../node-drag-design.md)）。
- 长按弹出上下文菜单（移动端替代右键）。
- 手势：pinch zoom（当前依赖 d3.zoom 内置 wheel，未适配双指）。
- 上下文菜单：`contextmenu` 事件当前由 MobileToolbar 部分承担，可抽出 `ContextMenu` 组件。

---

**文档结束**
