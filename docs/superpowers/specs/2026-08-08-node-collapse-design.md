# 设计文档：节点折叠功能

> **状态**：待实施
> **日期**：2026-08-08
> **相关模块**：`src/renderers/`、`src/features/`、`src/utils/mindmap-utils.ts`、`src/services/mindmap-service.ts`

---

## 1. 概述

### 1.1 目标

为 openMindMap 添加节点折叠功能：用户点击折叠按钮后隐藏该节点的整个子树，布局重新计算，**折叠节点的子树高度等于其自身节点高度**，使下方兄弟节点上移填补垂直空缺。折叠状态持久化到 markdown 文件。

### 1.2 非目标

- 不做折叠/展开动画过渡
- 不做"全部折叠/全部展开"命令
- 不做按层级折叠（如"折叠到第 2 层"）
- 不做折叠快捷键（本次仅按钮触发）
- 不修复既有测试基础设施

### 1.3 术语表

| 术语 | 含义 |
|---|---|
| **折叠节点** | `expanded === false` 的节点，其子树不参与布局与渲染 |
| **按钮栈** | 节点选中时出现在右侧的竖排按钮组（折叠 / `+` / AI） |
| **子节点数徽标** | 折叠节点上常驻的、显示直接子节点数量的小圆形标记 |
| **布局坐标系** | LayoutCalculator 输出的坐标：`x` = 垂直中心，`y` = 水平左边缘（反直觉） |
| **subtreeHeight** | 节点及其可见后代占据的总垂直空间 |

---

## 2. 数据模型与布局核心

### 2.1 复用既有字段

`MindMapNode.expanded` 字段已存在（`src/interfaces/mindmap-interfaces.ts:32`），当前恒为 `true` 且从不被读取。本特性将其变为真正的状态位，**不新增任何字段**。

### 2.2 唯一的布局改动点

折叠效果通过 D3 层级构造时过滤 children 实现，位于 `src/renderers/renderer-coordinator.ts:298`：

```ts
// 现在
root = d3.hierarchy(data.rootNode);

// 改为
root = d3.hierarchy(data.rootNode, d => d.expanded ? d.children : []);
```

### 2.3 为何无需改动 LayoutCalculator

这一行改动让整条渲染管线自动折叠感知：

- **`calculateAllSubtreeDimensions()`**（`layout-calculator.ts:419`）判断 `!node.children || length === 0` 时走叶子分支，令 `subtreeHeight = nodeHeight`。折叠节点在 D3 层级中就是叶子，因此**自动满足"折叠后子树高度等于根节点自身高度"这一核心需求**。
- **`distributeChildrenVerticalSpace()`**（`layout-calculator.ts:485`）对无 children 的节点提前 return，不为隐藏子节点分配垂直空间，兄弟节点自动上移。
- **`root.links()`**（`renderer-coordinator.ts:509`）与 **`root.descendants()`**（`:514`）天然不返回被折叠的后代，连线与节点 DOM 无需单独隐藏。
- **`calculateDynamicTreeHeight()`**（`:890`）用 `root.each()` 遍历，自动只统计可见节点。

### 2.4 数据完整性

`MindMapData.allNodes` 仍包含全部节点（用于查找、选中校验、文件保存），只有 D3 层级视图被裁剪。折叠不删除任何数据。

---

## 3. 交互与视觉

### 3.1 按钮栈布局

三个按钮竖排于节点右侧，折叠按钮位于最上方：

```
未选中，已折叠:                   选中态（任意节点）:
┌──────────┐                    ┌──────────┐  (▸)   ← 折叠按钮（新增，最上）
│  节点文本  │ ③                 │  节点文本  │  (+)   ← 现有
└──────────┘ ↑                  └──────────┘  (AI)  ← 现有
   常驻徽标，显示直接子节点数
```

### 3.2 按钮栈几何

按钮栈**固定三格，几何恒定**，与节点是否有子节点无关——这样切换选中不同节点时按钮不会跳变：

- `totalButtonsHeight = 20 * 3 + 10 * 2 = 80`（三个直径 20 的圆，两个 10px 间距）
- `buttonY = (dimensions.height - 80) / 2`
- 三按钮垂直偏移依次为 `+0`（折叠）、`+30`（`+`）、`+60`（AI）
- 水平位置沿用现有 `dimensions.width + 4`

现有代码中 `ButtonRenderer.ts:118` 的 `totalButtonsHeight = 20 + 10 + 20` 与 `AIAssistant.ts:84-86` 各自硬编码了同一常量。改为三格后，抽取共享辅助函数 `getButtonStackOffset(index)` 返回垂直偏移，供 `ButtonRenderer` 与 `AIAssistant` 共用，避免两处常量漂移。

### 3.3 折叠按钮行为

- **图标**：展开态 `▾`，折叠态 `▸`（树形控件惯例；不用 `+`/`−`，避免与"添加子节点"的 `+` 撞脸）
- **可见性**：跟随现有 `+`/AI 的显隐时机——在 `RendererCoordinator.handleNodeSelected()`（`:598`）与 `restoreSelectionUI()`（`:1049`）中渲染，在 `clearSelection()`（`:828`）中移除。后者按 class 选择器逐个移除按钮组，故需新增一行 `d3.selectAll('.collapse-button-group').remove();`。`MouseInteraction.clearSelection()`（`MouseInteraction.ts:213-214`）与 `performNodeSelection()`（`:331-332`）也各有一处按 class 移除按钮的代码，同样需补上折叠按钮组
- **无子节点时**：照常显示且可点击，点击切换 `expanded` 字段但无可见效果。因无子节点，`generateMarkdownFromNodes` 的写入条件不成立（见 4.3），不会产生无意义的 markdown 标记
- **根节点**：不显示折叠按钮，`expanded` 恒为 `true`

### 3.4 子节点数徽标

在 `NodeRenderer.renderNodes()` 中为满足 `!d.data.expanded && d.data.children.length > 0` 的节点追加：

- 位置：`x = dimensions.width + 4`，垂直居中
- 内容：直接子节点数量（`children.length`）
- `pointer-events: none`，不接收点击
- **节点被选中时隐藏徽标**，把右侧空间让给按钮栈（否则徽标与折叠按钮位置重叠）

### 3.5 样式

新增 `.node-collapse-button`、`.node-collapse-badge` 到 `src/styles/common.css`。移动端如需放大点击区，在 `src/styles/mobile.css` 覆盖，遵循现有 CSS 分层约定。

---

## 4. 状态变更与持久化

### 4.1 折叠切换流程

新增 `RendererCoordinator.handleToggleCollapse()`，紧邻 `handleAddChildNode`（`:645`）：

```
1. undoManager.saveSnapshot(this.currentData)   // 计入撤销栈
2. 若即将折叠：清除后代节点的选中/悬停状态（见 4.5）
3. node.data.expanded = !node.data.expanded
4. triggerDataUpdate()                          // → main.ts:handleDataUpdated()
                                                //   → refreshMindMapLayout() 重新渲染
                                                //   → saveToMarkdownFile() 写入文件
```

注意第 2 步**不能**调用 `clearSelection()`——那会连被折叠节点自身的选中态一并清除，用户刚点击的按钮栈随即消失，无法连续操作。正确做法见 4.5。

复用既有 `triggerDataUpdate()` 通路，重新布局与文件保存均免费获得，不新增渲染路径。

回调经 `InteractionManager` 的 `RenderCallbacks` 接口传递，新增 `onToggleCollapse?: (node) => void`，与现有 `onAddChildNode` 等保持一致。

### 4.2 折叠节点上的添加操作：自动展开

在 `MindMapService.createChildNode()`（`mindmap-service.ts:151`）内设置 `parentNode.expanded = true`。一处改动覆盖全部四个入口：

| 入口 | 调用点 |
|---|---|
| Tab 键 / `+` 按钮 | `renderer-coordinator.ts:659` |
| AI 建议 | `AIAssistant.ts:352` |
| 粘贴 | `ClipboardManager.ts:222` |

`createSiblingNode()` 无需改动——新兄弟节点挂到 `afterNode.parent` 下，而该父节点必然已展开（否则 `afterNode` 不可见、无法被选中）。

### 4.3 Markdown 写入

`generateMarkdownFromNodes()`（`mindmap-utils.ts:155`）在列表项首行末尾追加标记。**仅当 `!node.expanded && node.children.length > 0` 时写入**——展开态与无子节点态不写，文件保持干净：

```markdown
* 节点文本 [collapsed:true]
    * 子节点
```

### 4.4 Markdown 读取

`parseListItem()`（`mindmap-utils.ts:126`）在调用 `cleanTextContent()` **之前**用 `/\[collapsed:true\]\s*$/` 探测标记并返回 `collapsed` 标志，供 `parseMarkdownContent()`（`:221`）设置 `expanded: !collapsed`。

`cleanTextContent()`（`:22`）已有的 `[key:value]` 剥离规则会自动将标记从显示文本中移除，**无需改动该函数**。

**边界情形**：

- **多行文本**：标记只出现在 `* ` 首行。续行走 `:253` 分支，从不经过 `cleanTextContent`，不受影响。写入时同样只追加到 `lines[0]`。
- **根节点**：`generateNodeMarkdown` 在 `level === 0` 时 return（`:148`），天然无对应行；根节点不可折叠，无需持久化。
- **健壮性**：`[collapsed:false]` 或其他 `[collapsed:*]` 值一律视为展开（只认字面 `true`），且仍会被 `cleanTextContent` 剥离，不污染节点文本。

### 4.5 撤销与选中态一致性

**撤销**：`UndoManager.deepCloneNode()`（`UndoManager.ts:134`）用 `{ ...node }` 浅拷贝全部字段后递归 children，`expanded` 作为布尔字段自动被快照捕获，**无需修改 UndoManager**。

**选中态**：折叠含当前选中节点的子树时，选中节点会从 D3 层级中消失。`syncSelectedNodeReference()`（`:1006`）找不到匹配节点时会置 `selectedNode = null`，但 `data.selected` 仍为 `true`，且 `validateSelectionState()`（`:854`）不会清除它——下次展开时旧高亮会复活。

因此折叠前须清除**后代节点**（不含被折叠节点自身）的 `selected` 与 `hovered` 标志。实现上遍历 `node.data.children` 递归置 false，模式参照现有 `clearAllSelectionStates()`（`:841`）。若被折叠节点自身原本是选中态，则保持选中——用户刚点了它的按钮，按钮栈应继续可用。

若被清除的正是 `this.selectedNode`，还需同步置 `this.selectedNode = null`，避免悬空引用。

---

## 5. 受影响文件

| 文件 | 改动 |
|---|---|
| `renderers/renderer-coordinator.ts` | `d3.hierarchy` 加 children 访问器；新增 `handleToggleCollapse()`；接线回调；`clearSelection()` 移除折叠按钮组 |
| `features/ButtonRenderer.ts` | 新增折叠按钮渲染；按钮栈改三格常量；抽取 `getButtonStackOffset()` |
| `features/AIAssistant.ts` | AI 按钮偏移改用共享栈偏移 |
| `renderers/core/NodeRenderer.ts` | 折叠态子节点数徽标 |
| `utils/mindmap-utils.ts` | `[collapsed:true]` 读写 |
| `services/mindmap-service.ts` | `createChildNode` 自动展开父节点 |
| `interactions/interaction-manager.ts` | `RenderCallbacks` 增 `onToggleCollapse` |
| `interactions/MouseInteraction.ts` | 两处按 class 移除按钮的代码补上折叠按钮组 |
| `styles/common.css` | 按钮与徽标样式 |

---

## 6. 验证策略

### 6.1 测试基础设施现状

当前项目**没有可运行的自动化测试**：

- `npm test` 指向不存在的 `test/test-overlap-verification.js`
- `npm run test:unit` 指向不存在的 `test/unit-tests.js`
- `esbuild.test.config.mjs` 入口 `src/mindmap-core.ts` 不存在
- 唯一单测 `test/unit/coordinate-system.test.ts` 用 Jest 语法编写，但 `package.json` 无 Jest 依赖

本特性**不引入 Jest、不修复该基础设施**（属独立工作，会使范围失控）。

### 6.2 静态校验

- `npm run build`（含 `tsc -noEmit -skipLibCheck`）必须通过
- `npm run lint` 必须通过

### 6.3 Markdown 往返手工验证

以 `test/test-data.md` 为样本：折叠若干节点 → 检查文件出现 `[collapsed:true]` → 关闭重开 → 折叠状态如实恢复，且节点显示文本不含标记残留。

### 6.4 验收标准清单（Obsidian 内手工验证）

- [ ] 折叠中间节点后，其下方兄弟节点上移、垂直空缺被填补（即 `subtreeHeight = nodeHeight` 生效）
- [ ] 对折叠节点按 Tab / 点 `+` / 用 AI 建议 / 粘贴 → 均自动展开，且新节点进入编辑态
- [ ] 折叠含选中节点的子树 → 展开后无残留高亮
- [ ] 折叠某节点后，该节点自身仍保持选中、按钮栈仍可用（可连续点击展开）
- [ ] Ctrl+Z 撤销折叠、Ctrl+Y 重做折叠
- [ ] 无子节点的节点点击折叠按钮 → 无视觉变化、不写入标记、不报错
- [ ] 根节点不显示折叠按钮
- [ ] 切换选中不同节点时，按钮栈位置不跳变
- [ ] 折叠节点未选中时显示子节点数徽标；选中时徽标隐藏
- [ ] 多行文本节点折叠后，标记只落在首行
- [ ] 桌面端与移动端（用 Device Type 设置切换）各验证一遍
