# Feature 模块设计

> **范围**：`src/features/*`（AIAssistant、NodeEditor、ClipboardManager、ButtonRenderer、MobileToolbar）
> **模式**：Callback-based Component（无相互依赖，通过回调解耦）
> **依赖**：`MindMapService`、`TextMeasurer`、`MindMapMessages`、`MindMapConfig`

---

## 1. 模块职责

Feature 层封装**独立的高级交互能力**，每个模块单一职责，通过构造函数注入 + 回调对外通信，可独立测试与替换。

```
RendererCoordinator (Mediator)
    ├── AIAssistant       ── AI 子节点建议
    ├── NodeEditor        ── 文本编辑（进入/保存/取消/校验/提示）
    ├── ClipboardManager  ── 复制 / 剪切 / 粘贴（Markdown 感知）
    ├── ButtonRenderer    ── 选中节点右侧「+」按钮
    └── MobileToolbar     ── 移动端节点上方浮动工具栏（仅 isMobile）
```

---

## 2. `NodeEditor`

### 2.1 API

```typescript
class NodeEditor {
    constructor(
        config: MindMapConfig,
        messages: MindMapMessages,
        callbacks: NodeEditorCallbacks,
        editingState?: EditingState,     // 允许外部注入共享引用
    );

    enableEditing(node, editElement: HTMLDivElement): void;
    exitEditMode(): void;
    cancelEdit(): void;
    saveText(): void;

    validateText(text): boolean;
    isEditing(): boolean;
    isCanvasInteractionEnabled(): boolean;
    getEditingState(): Readonly<EditingState>;
    destroy(): void;
}
```

### 2.2 `NodeEditorCallbacks`

```typescript
{
    onBeforeTextChange?: (node, oldText, newText) => void;  // Undo 快照点
    onTextChanged?:      (node, newText) => void;
    onCanvasInteractionChanged?: (enabled: boolean) => void;
}
```

### 2.3 `EditingState`（共享）

```typescript
interface EditingState {
    isEditing: boolean;
    currentNode: HierarchyNode<MindMapNode> | null;
    originalText: string;
    editElement: HTMLDivElement | null;
}
```

**关键**：`NodeEditor` 更新此对象的属性而**非替换对象**，这样 `TextRenderer` / `RendererCoordinator` / `InteractionManager` 持有的引用始终指向同一状态。

### 2.4 进入编辑流程

```
enableEditing(node, div):
    1. 若已在编辑其他节点 → exitEditMode（保存前一处）
    2. 根节点保护：
         if depth === 0:
             if debugMode: logger.flushToClipboard()  // iPad debug 导出入口
             else: Notice(cannotEditRoot); return
    3. setCanvasInteraction(false) + onCanvasInteractionChanged(false)
    4. 更新 editingState 属性（不重建）
    5. div.contentEditable = "true"
       div.classList.add("editing", "node-editing")
    6. setTimeout(10ms) → focus + range.selectNodeContents(全选)
    7. setTimeout(100ms) → showEditingHint()
```

### 2.5 保存流程

```
saveText():
    newText = editElement.textContent.trim()
    if !validateText(newText): showValidationError; return
    if newText === originalText: exitEditMode; return
    onBeforeTextChange?(node, originalText, newText)   // ← Undo saveSnapshot
    node.data.text = newText
    onTextChanged?(node, newText)                      // → 300ms 防抖存盘
    exitEditMode()
```

### 2.6 校验规则

```
validateText(text):
    非空 &&
    text.length ≤ MAX_TEXT_LENGTH (500) &&
    无 INVALID_CHARACTERS (['\t'])
```

失败：临时 DOM `.mind-map-validation-error`，3s 后 200ms 淡出移除。

### 2.7 提示 UI

- 单例 `.editing-hint` DOM，`config.isMobile` 决定文案：
  - 桌面：`editHintDesktop`（"Enter 保存 / Escape 取消 / Alt+Enter 换行"）
  - 移动：`editHintMobile`（"点空白保存 / 键盘换行"）
- `showEditingHint` 延时 100ms 避免抢焦点。

---

## 3. `AIAssistant`

### 3.1 API

```typescript
class AIAssistant {
    constructor(mindMapService, messages, callbacks: { onNodeCreated?: () => void });

    renderAIButton(nodeElement, node, dimensions: NodeDimensions): void;
    removeAIButton(nodeElement): void;
    triggerSuggestions(node): Promise<void>;
    clearSelectedSuggestions(): void;
    destroy(): void;
}
```

### 3.2 内部状态

```
selectedSuggestions: Set<string>   // 已被创建为子节点的建议文本（跨面板打开去重）
loadingNotice: Notice | null       // 复用 Notice，避免重复弹出
```

### 3.3 AI 按钮布局

```
totalButtonsHeight = plusButton(20) + gap(10) + aiButton(20) = 50
X = node.width + 4                      // 与 +按钮同 X
Y = (node.height − 50) / 2 + 30         // 在 +按钮下方 10px
外观：紫色圆背景 #9333ea + emoji ✨
```

### 3.4 触发流程

```
triggerSuggestions(node):
    校验 service + 节点文本非空
    显示 Notice(aiAnalyzing, {nodeText})
       - 已有 loadingNotice → setMessage()   ← 复用避免闪烁
       - 否则新建
    suggestions = await mindMapService.suggestChildNodes(node.data)
    loadingNotice.hide()
    if suggestions.length === 0: Notice(aiNoSuggestions); return
    showSuggestionsPanel(node, suggestions)

.ai-suggestions-panel  (直接 append 到 document.body，避免被 D3 重渲染移除)
    ├── .ai-suggestions-header
    │     ├── title (aiSuggestionsTitle)
    │     └── .ai-suggestions-actions
    │           ├── button "Add All" (aiAddAll)
    │           └── button "✕" (aiClose)
    └── .ai-suggestions-list
          └── .ai-suggestion-item * n
                  click → createChildNode + 打勾 (.ai-suggestion-item-selected + ✓)
                        + selectedSuggestions.add(text)
                        + callbacks.onNodeCreated()
                  Add All → 循环触发
```

### 3.5 与 Service 协作

**NodeContext 组装** 在 `MindMapService.suggestChildNodes`：

```typescript
{
    nodeText,
    level,
    parent: node.parent?.text,
    siblings: parent.children.filter(!==node).map(text),
    existingChildren: node.children.map(text),
    centralTopic: 沿 parent 上溯至 root
}
```

进一步走 `AIClient.suggestChildNodes` → `AIPrompts.buildUserPrompt` → REST → JSON 解析 → 去重（vs existingChildren）→ 最多 5 条。

---

## 4. `ClipboardManager`

### 4.1 API

```typescript
class ClipboardManager {
    constructor(mindMapService, messages, callbacks: { onDataUpdated?, clearSelection? });

    copyNode(node): Promise<boolean>;
    cutNode(node): Promise<boolean>;
    pasteToNode(node): Promise<boolean>;
    destroy(): void;
}
```

### 4.2 复制

```
copyNode(node):
    md = mindMapService.serializeSubtreeToMarkdown(node.data)
    await navigator.clipboard.writeText(md)
    Notice(nodeTextCopied, 2000ms)
    return true
```

### 4.3 剪切

```
cutNode(node):
    await copyNode(node)
    mindMapService.deleteNode(node.data)   // 内部处理 level=0 拒绝
    callbacks.clearSelection?.()
    callbacks.onDataUpdated?.()             // 触发重渲染 + 存盘
    return true
```

### 4.4 粘贴智能路由

```
pasteToNode(target):
    if !navigator.clipboard || !window.isSecureContext: return false
    text = await readText()
    if !text.trim(): return false

    isMarkdownList = /^\s*[-*]/m.test(text)
    if isMarkdownList:
        subtree = mindMapService.createSubtreeFromMarkdown(text, target.data.level)
        if subtree:
            target.data.children.push(subtree); subtree.parent = target.data
            subtree.selected = true             // 数据层选中（避免依赖 DOM）
            callbacks.onDataUpdated?.()
            return true
        // 解析失败 → 降级为纯文本
    // 纯文本
    text = text.slice(0, MAX_TEXT_LENGTH)
    child = mindMapService.createChildNode(target.data, text)
    child.selected = true
    callbacks.onDataUpdated?.()
```

### 4.5 通知策略

- 成功 2000ms
- 失败 3000ms（`copyFailed`）
- 静默失败：无剪贴板 API / 空剪贴板

---

## 5. `ButtonRenderer`

### 5.1 API

```typescript
class ButtonRenderer {
    constructor(_service, textMeasurer, callbacks: ButtonRendererCallbacks);

    renderButtons(nodeElements): void;      // 遍历，仅 selected 节点渲染
    renderPlusButton(nodeElement, node, dimensions): void;
    removePlusButton(nodeElement): void;
    destroy(): void;
}
```

### 5.2 `ButtonRendererCallbacks`

```typescript
{
    onAddChildNode?: (node) => void;         // 唯一直接对外事件
    enterEditMode?, clearSelection?, selectNode?, onDataUpdated?
}
```

### 5.3 位置计算

```
totalButtonsHeight = 20 + 10 + 20 = 50    // + 按钮 + gap + AI 按钮预留
buttonY = (dimensions.height − 50) / 2
buttonX = dimensions.width + 4

视觉：蓝色圆 #2972f4，半径 10，中心 + 字符白色 16px bold
text: pointer-events: none（事件走圆背景）
```

### 5.4 与 AIAssistant 共存

`ButtonRenderer` 负责「+」按钮，`AIAssistant` 负责「✨」按钮。二者按同一 X 对齐，Y 上下堆叠，`totalButtonsHeight = 50` 是共享常量。

---

## 6. `MobileToolbar`

### 6.1 API

```typescript
class MobileToolbar {
    constructor(textMeasurer, messages, callbacks: MobileToolbarCallbacks);

    create(svg): void;                       // 挂在 .mindmap-content 组下
    updatePosition(node, offsetX, offsetY): void;
    hide(): void;                            // 150ms 淡出
    destroy(): void;
}
```

### 6.2 `MobileToolbarCallbacks`

```
{ onEdit?, onCopy?, onPaste?, onDelete? }
```

### 6.3 位置计算（复用坐标转换约定）

```
nodeCanvasX = node.y + offsetX                          // node.y = 水平左缘
nodeCanvasY = node.x + offsetY − dimensions.height/2    // node.x = 垂直中心

toolbarWidth = 320
toolbarHeight = 44
toolbarOffsetX = (dimensions.width − 320) / 2           // 水平居中于节点
toolbarOffsetY = −44 − 12                                // 节点上方 12px 间隙
```

### 6.4 视觉

- 黑色圆角背景 `#000000` rx=8
- 三条 `#333333` 分隔线
- 底部指向节点的箭头 `path M 200 52 L 192 44 L 208 44 Z`
- 4 个按钮（图标 emoji + 文本）：edit ✏️ / copy 📋 / paste 📑 / delete 🗑️
- 按钮 `pointer-events: none`，事件冒泡到 group

### 6.5 动画

- 使用 `d3.interrupt()` 中断进行中的动画。
- opacity 0 → 1 淡入（`requestAnimationFrame` 触发）。
- `hide()`：150ms 淡出后 `display: none` + 清空 `currentNode`。

### 6.6 点击行为

```
handleButtonClick(action, event):
    event.stopPropagation()
    navigator.vibrate?.(50)                  // 触觉反馈（Android）
    分发 callback（copy/paste 返回 Promise，用 void 抛弃）
```

### 6.7 重建时机

由 `RendererCoordinator.render()` 结束时重建，保证工具栏总是绑定最新 SVG。

---

## 7. 协作矩阵

| Feature | 依赖 | 主要事件 | 触发来源 |
|---|---|---|---|
| NodeEditor | config, messages | onBeforeTextChange (undo), onTextChanged (save) | 双击 / MobileToolbar.edit |
| AIAssistant | mindMapService | onNodeCreated | ✨ 按钮点击 |
| ClipboardManager | mindMapService | onDataUpdated | 快捷键 / MobileToolbar.copy/paste |
| ButtonRenderer | textMeasurer | onAddChildNode | + 按钮点击 |
| MobileToolbar | textMeasurer, messages | onEdit/Copy/Paste/Delete | 移动端节点选中 |

## 8. 演进空间

- 抽出 `PopupPanel` 基类，让 AI 面板、右键菜单、Toolbar 复用相同布局与动画逻辑。
- 支持自定义按钮插件（用户扩展新的节点操作）。
- 图片 / 文件粘贴（当前仅支持文本）。
- AI 建议：流式响应、多轮对话（当前一次性获取 5 条）。
- 移动端上下文菜单可替代 Toolbar 的部分功能。

---

**文档结束**
