# Renderer 模块设计

> **范围**：`src/renderers/*`、`src/renderers/core/*`
> **模式**：Strategy（设备分叉）+ Mediator（Coordinator）+ Composition
> **依赖**：D3.js v7、`TextMeasurer`、`CoordinateConverter`

---

## 1. 模块职责

将 `MindMapData` 渲染为可交互的 SVG 树，管理视口、选中、编辑、Undo/Redo 与移动端工具栏。

## 2. 分层

```
RendererManager  (Strategy: pick by config.isMobile)
    │
    ├── DesktopTreeRenderer  ── 桌面壳
    └── MobileTreeRenderer   ── 移动壳（追加 .is-mobile CSS 类）
              │
              └── RendererCoordinator  ★ 核心
                    ├── LayoutCalculator   ── 两阶段 O(N) 树布局
                    ├── NodeRenderer       ── <g>+<rect> 节点
                    ├── LinkRenderer       ── 贝塞尔/圆角折线
                    ├── TextRenderer       ── <foreignObject>+<div> 文本
                    ├── InteractionManager ── 交互桥接
                    ├── NodeEditor
                    ├── AIAssistant
                    ├── ClipboardManager
                    ├── ButtonRenderer
                    ├── MobileToolbar (mobile only)
                    └── UndoManager
```

---

## 3. 坐标系约定（全模块共享）

**布局坐标**（`LayoutCalculator` 输出）：

| 字段 | 含义 |
|---|---|
| `node.x` | **垂直中心** Y（画布纵坐标） |
| `node.y` | **水平左边缘** X（画布横坐标） |
| `nodeWidth / nodeHeight` | 节点尺寸 |
| `subtreeWidth / subtreeHeight` | 子树包围盒 |

**画布坐标**（SVG）：

```
canvasX = node.y + offsetX
canvasY = node.x + offsetY − nodeHeight/2
```

由 `CoordinateConverter` 提供转换封装（见 `utils/coordinate-system.ts`）。

⚠️ 该转置源于 D3 tree layout 的默认约定，历史遗留至今；所有 Renderer 严格遵守。

---

## 4. `RendererManager`（Strategy）

```typescript
class RendererManager implements MindMapRenderer {
    constructor(app, config, mindMapService, messages?, isActiveView?);

    render(container, data): void
    destroy(): void
    getActiveRenderer(): MindMapRenderer
    isMobile(): boolean

    get/set onTextChanged
    get/set onDataUpdated
}
```

- 构造时依据 `config.isMobile` 一次性实例化 Desktop 或 Mobile TreeRenderer。
- **无回落，无切换**（Early Branching）。
- 回调用 getter/setter 透传到底层 renderer。

## 5. `DesktopTreeRenderer` / `MobileTreeRenderer`

- Desktop：薄壳，仅创建 `RendererCoordinator` 并转发 render/destroy。
- Mobile：继承 Desktop，`render()` 时在 container 加 `.is-mobile` class 以激活样式；`destroy()` 时移除。
- **实际差异极小**，主要靠 `RendererCoordinator` 内部据 `config.isMobile` 分叉 MobileToolbar 等。

---

## 6. `RendererCoordinator`（Mediator，核心 ~1200 行）

### 6.1 组成

**核心渲染**：`TextMeasurer` / `LayoutCalculator` / `NodeRenderer` / `LinkRenderer` / `TextRenderer`
**特性**：`InteractionManager` / `NodeEditor` / `AIAssistant` / `ClipboardManager` / `ButtonRenderer` / `MobileToolbar`（仅移动端）
**状态**：`UndoManager` + 一系列引用字段

### 6.2 关键字段

| 字段 | 用途 |
|---|---|
| `currentSvg / currentContent` | 顶层 `<svg>` 与内容 `<g>` D3 选择 |
| `currentZoom / currentZoomTransform` | d3.zoom 行为 & 当前变换（持久化视口）|
| `currentData: MindMapData \| null` | 当前渲染数据引用（Undo/Redo 时**就地改写**）|
| `currentContainer / resizeObserver` | Fix A1：跟踪容器尺寸变化 |
| `stickySvgWidth/Height` | Sticky-max：SVG 尺寸只增不减 |
| `isRendering` / `pendingRenderRequest` | 渲染锁 & 挂起队列 |
| `selectedNode / hoveredNode` | D3 层次节点引用 |
| `editingState: EditingState` | 与 `NodeEditor` / `TextRenderer` **共享同一对象** |
| `canvasInteractionEnabled` | 编辑模式关闭 zoom/pan |
| `layoutConfig` | 布局常量本地覆盖（大部分与 `constants` 一致）|

### 6.3 对外回调

```typescript
onDataUpdated?(): void
onTextChanged?(node, newText): void
onDataRestored?(data): void          // Undo/Redo 时通知 View 同步引用
```

`RenderCallbacks`（由 `InteractionManager` 反向调用）：
`onNodeSelected/Hovered/Left/SelectionCleared/NodeDoubleClicked/AddChildNode/AddSiblingNode/DeleteNode/CopyNode/CutNode/PasteToNode/ExitEditMode/Undo/Redo`

### 6.4 `render()` 主流程

```
if isRendering: mark pendingRenderRequest; return
try:
    currentData = data
    validateSelectionState()         // 清理多选异常
    container.innerHTML = ''
    initW, initH = 计算容器尺寸(fix A1)
    svg = 创建 <svg> + attachContainerResizeObserver(sticky max)
    content = <g class="mindmap-content">
    root = d3.hierarchy(data.rootNode)
    calculateDynamicTreeHeight(root)          // 见 6.5
    layoutCalculator.createCustomTreeLayout(root, dimsFn)
    createGradientDefinitions(svg)            // #linkGradient
    setupZoom(svg, container)                 // scaleExtent([0.1, 4]), filter 排除 contenteditable
    立即应用 currentZoomTransform            // 防跳动
    renderLinks(); renderNodes()              // 内部 attachInteractionHandlers
    restoreViewState(); applyInitialViewPosition()
finally:
    unlock; 若 pending: setTimeout(16ms) 再次 render
    syncSelectedNodeReference(root)
    移动端重建 MobileToolbar
    restoreSelectionUI()
```

### 6.5 关键算法：动态高度补偿

**目的**：防止深层子树重叠。

```
for each layer:
    layerHeight = max(dims(depth, text).height) + min(avgLen*2, 50)
    minLayerHeight = {0:80, 1:70, ≥2:60}[depth]
    layer = max(layerHeight, minLayerHeight)

depthMultiplier(d) = {0.8, 1.0, 1.3, 1.8, 2.2 + (d-4)*0.3}[d]
countMultiplier(n) = n > 3 ? 1 + (n-3)*0.1 : 1

total = Σ layer * depthMult * countMult
      + max(100, maxDepth * 25)          // depthBuffer

treeHeight = max(total, layoutConfig.treeHeight=800)
→ layoutCalculator.updateConfig({treeHeight})
```

### 6.6 关键算法：选中引用同步

每次 `render()` 后 `d3.hierarchy` 会生成全新的 HierarchyNode 对象，旧的 `selectedNode` 引用会失效。`syncSelectedNodeReference(root)`：

```
1. target = selectedNode?.data                       // 策略1：从旧引用
2. if !target: DFS root.data 找 data.selected===true // 策略2：从数据
3. 用 root.each 找到 d.data === target 的新节点
4. 更新 selectedNode 引用
```

### 6.7 Fix A1：Sticky-max SVG 尺寸

iPad 软键盘弹出时容器高度骤降，若 SVG 尺寸随之收缩，节点会消失或错位。策略：

```
onResize(entries):
    cr = entry.contentRect
    nextW = max(stickyW, cr.width)
    nextH = max(stickyH, cr.height)
    if nextW > stickyW || nextH > stickyH:
        svg.attr('width', nextW).attr('height', nextH)
        stickyW = nextW; stickyH = nextH
```

**只增不减**，用户切回后视图无跳动。

### 6.8 Undo / Redo

```typescript
undo(): boolean {
    prev = undoManager.undo(currentData);
    if !prev: return false;
    // 就地改写引用，不 replace（避免 View 层 stale reference）
    currentData.rootNode = prev.rootNode;
    currentData.allNodes = prev.allNodes;
    currentData.maxLevel = prev.maxLevel;
    clearSelection();
    onDataRestored?.(prev);        // View 更新 mindMapData
    triggerDataUpdate();           // 重新渲染 + 存盘
    return true;
}
```

---

## 7. `LayoutCalculator`

### 7.1 API

```typescript
class LayoutCalculator {
    constructor(config?: Partial<LayoutConfig>);
    createCustomTreeLayout(root, dimensionsCallback): void;    // 主入口
    calculateAdaptiveHorizontalSpacing(sourceW, targetW): number;
    calculateTreeDimensions(root): { width, height };
    centerTree(root, canvasW, canvasH): { offsetX, offsetY };
    getConfig() / updateConfig(newConfig);
}
```

### 7.2 两阶段布局（O(N)）

**阶段 1** — `calculateAllSubtreeDimensions(root)` 使用 `root.eachAfter`：

```
if leaf:
    node.subtreeWidth  = node.nodeWidth
    node.subtreeHeight = node.nodeHeight
else:
    node.subtreeWidth  = max(nodeWidth,  max(child.subtreeWidth))
    node.subtreeHeight = max(nodeHeight, Σ child.subtreeHeight + verticalGap*(n-1))
    // verticalGap = 10
```

**阶段 2** — `setNodePositionsTopDown(root, x, y, ...)` 前序递归：

```
node.x = x; node.y = y

// horizontalSpacing 分级：根→L1 用 80，其余 30
hs = depth === 0 ? 80 : 30
totalH = Σ child.subtreeHeight + gap * (n-1)
currentY = node.x − totalH/2

for each child:
    childX = currentY + child.subtreeHeight/2
    childY = node.y + node.nodeWidth + hs         // 兄弟左对齐！
    recurse(child, childX, childY, ...)
    currentY += child.subtreeHeight + gap
```

**要点**：兄弟节点共享同一 childY（父节点右缘 + hs），产生规整的树形分栏。

### 7.3 自适应水平间距

```typescript
calculateAdaptiveHorizontalSpacing(sw, tw): number {
    spacing = max(sw * SOURCE_RATIO, tw * TARGET_RATIO) + BASE_SPACING
    spacing = clamp(spacing, MIN, MAX)
    return spacing + SAFETY_MARGIN
}
```

（当前主流程使用硬编码 80/30，此方法预留给后续 config 驱动版本。）

---

## 8. `NodeRenderer`

```typescript
class NodeRenderer {
    constructor(textMeasurer, layoutCalculator);
    renderNodes(svg, nodes, offsetX, offsetY): d3.Selection<SVGGElement, ...>;
    getNodePadding(depth): number;   // 0→24, 1→20, ≥2→16
}
```

**渲染细节**：
- 容器 `<g class="nodes">`，data-join 生成 `<g>`。
- `transform`：`CoordinateConverter.createTransform(x, y, w, h, offsetX, offsetY)`。
- A11y：`role="button"`、`aria-label`、`tabindex="0"`、`aria-level=depth+1`。
- `<rect class="node-rect" rx=6 ry=6>`：
  - depth=0 → fill `#2972f4`，stroke `#2972f4` width=2
  - 其他 → fill `#f3f5f7`，无 stroke
- `d.data.selected` 时追加 `.selected-rect` class。

---

## 9. `LinkRenderer`

```typescript
class LinkRenderer {
    constructor(textMeasurer, config?: { lineOffset: 6 });
    renderLinks(svg, links, offsetX, offsetY): void;
}
```

### 9.1 连线策略分层

| 场景 | 曲线 | Class |
|---|---|---|
| 根 → L1 | 三次贝塞尔 | `.root-to-first-level-link` |
| 其他层 | 圆角折线 | `.rounded-link` |

### 9.2 三次贝塞尔（根→L1）

```
Δx = tx − sx
C1 = (sx + Δx*0.3, sy)     // 从源沿正 X 出
C2 = (tx − Δx*0.3, ty)     // 逼近目标 Y
path = M sx,sy C c1x,c1y c2x,c2y tx,ty
```

### 9.3 圆角折线（其他层）

```
turn1X = sx + horizontalDistance * 0.45
radius = min(cornerRadius=8, |tx−turn1X|*0.4, |ty−sy|*0.4)
verticalEndY = ty + (sy<ty ? −radius : radius)
path: M sx,sy → L turn1X,sy → L turn1X,verticalEndY
      → Q turn1X,ty  turn1X±radius,ty
      → L tx,ty
```

**属性**：stroke=2, `stroke-linejoin=round`。

### 9.4 连接点计算

- 源右缘 X：`toRightEdge(source.y, sourceWidth, sourcePadding, lineOffset, offsetX)`
- 目标左缘 X：`toLeftEdge(target.y, targetPadding, lineOffset, offsetX)`
- Y（中心）：`toCanvasY(node.x, 0, offsetY)`

`lineOffset = 6` 让连线不紧贴节点边框。

---

## 10. `TextRenderer`

### 10.1 结构

每个节点使用 `<foreignObject>` + `<xhtml:div class="node-unified-text">` 承载文本，实现**显示与编辑复用同一 DOM**。

```typescript
renderText(nodeElements, onEditCallback?, parentContext?): void;
static attachTextEditHandlersToNode(textDivNode, nodeData, onEditCallback?, parentContext?): void;
updateEditingState(editingState): void;
updateParentContext(parentContext): void;
```

### 10.2 样式

- `contenteditable="false"` 默认。
- `text-align`：depth ∈ {0,1} 居中，其余左对齐。
- `word-wrap: normal; white-space: pre; overflow: visible` — **禁用自动换行**，仅保留 `\n`。
- `line-height: 1.3`，`font-family: var(--font-text)`。
- 颜色：depth=0 白色，其余黑色。

### 10.3 编辑态键盘处理

仅在 `contentEditable === "true"` 时激活：

| 按键 | 桌面 | 移动 |
|---|---|---|
| Enter | preventDefault → `saveNodeText()` | Selection API 插入 `\n`，光标后移 |
| Alt+Enter | preventDefault，keyup 时插入 `\n` | — |
| Escape | preventDefault → `cancelEditMode()` | 同 |
| Backspace | 光标前是 `\n` → 手动删除该 `\n` | 同 |
| 其他 | 触发 `onEditCallback` | 同 |

### 10.4 Fix B1：Blur 差异

- **桌面端**：`setTimeout(saveNodeText, 150ms)`（等待可能的紧接的 click 事件）。
- **移动端**：**不**在 blur 触发保存（iPad 软键盘偷焦点会误保存），改用画布 tap / Enter / Escape 显式退出。

---

## 11. 性能

| 项 | 策略 |
|---|---|
| 重入渲染 | `isRendering` 锁 + `pendingRender` 挂起 |
| 首帧不闪 | 立即应用 `currentZoomTransform`，之后再 restore view state |
| SVG 尺寸抖动 | Sticky-max ResizeObserver |
| 大文本换行 | 禁用自动换行，避免测量成本 |
| 缓存 | `TextMeasurer` 双层缓存节点尺寸 |

---

## 12. 演进空间

- 抽出 `SelectionManager` 集中处理数据/DOM/引用三通道。
- 将 `LayoutCalculator` 硬编码 80/30 迁到 config。
- 连线策略可配置（曲线 / 直线 / 分层可切换）。
- 虚拟化：超过 `PERFORMANCE_CONSTANTS.MAX_NODES_BEFORE_VIRTUALIZATION` 时启用视口裁剪。
- 独立 Desktop/Mobile 渲染器（当前差异极小，未真正利用二叉设计）。

---

**文档结束**
