# 架构设计（Architecture）

> **状态**：现行
> **版本**：对应源码 v1.0.0（截至 2026-07）
> **范围**：全局架构、关键类、跨模块协作、数据流

---

## 1. 项目定位

openMindMap 是一个 Obsidian 社区插件，它将以 `#mindmap` 起始的 Markdown 文件渲染为交互式脑图。核心特性：

- **文件即数据**：脑图完全由 Markdown 列表描述（4 空格 = 1 层），无自定义扩展格式。
- **视图替换**：检测到 `#mindmap` 时用自定义 `ItemView` 取代默认 Markdown 编辑器。
- **设备双分支**：桌面 / 移动端在插件启动时**一次性**分叉，二者代码互不交叉。
- **模块化**：Service / Handler / Renderer / Interaction / Feature 各司其职，通过构造函数注入组合。
- **AI 建议**：通过任意 OpenAI 兼容 API 为当前节点生成子节点候选。
- **端到端安全**：API Key 使用 AES-GCM 256 加密后持久化。

---

## 2. 顶层分层

```
┌───────────────────────────────────────────────────────────────────┐
│  Obsidian Runtime  (workspace, ItemView, Notice, requestUrl…)     │
└───────────────┬───────────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │   MindMapPlugin (main.ts) ── Composition Root             │
        │   ● 设备检测 / 组装 / 生命周期 / 命令 / 事件监听           │
        └───────┬────────────────────────────────────────────────┘
                │
       ┌────────┴─────────────┬───────────────────┐
       ▼                      ▼                   ▼
┌─────────────┐        ┌────────────────┐   ┌────────────────┐
│ ConfigMgr   │        │ MindMapService │   │ AIClient       │
│ (Strategy)  │        │ (Facade)       │   │ (Adapter)      │
└─────┬───────┘        └───────┬────────┘   └────────────────┘
      │                        │
      ▼                        │
 Desktop/Mobile Config         │
                               ▼
                     ┌──────────────────────┐
                     │  MindMapView (View)  │
                     │  ● 状态、生命周期     │
                     └──────────┬───────────┘
                                │
                                ▼
                     ┌──────────────────────┐
                     │  RendererManager     │  ← 设备分支 #2
                     └──────────┬───────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
    ┌──────────────────┐                ┌──────────────────┐
    │ DesktopTreeRnd   │  (壳，透传)     │ MobileTreeRnd    │
    └────────┬─────────┘                └────────┬─────────┘
             │                                   │
             ▼                                   ▼
    ┌───────────────────────────────────────────────────────┐
    │            RendererCoordinator  (Mediator)            │
    │  ● 组合 Layout / Node / Link / Text / 交互 / 特性     │
    │  ● 渲染锁、视口持久化、Undo/Redo、选中同步            │
    └────┬──────────┬──────────┬──────────┬──────────┬─────┘
         │          │          │          │          │
         ▼          ▼          ▼          ▼          ▼
     Layout     NodeRnd     LinkRnd    TextRnd   InteractionMgr
     Calc                                        ├─ MouseInteraction
                                                 └─ KeyboardManager

  + Feature 层：AIAssistant / NodeEditor / ClipboardManager
                ButtonRenderer / MobileToolbar / UndoManager
```

**读法**：上层持有下层引用；下层通过回调（`onXxx`）反向通知上层，不直接调用。

---

## 3. 关键设计模式

| 模式 | 出现位置 | 目的 |
|---|---|---|
| **Composition Root** | `MindMapPlugin.onload()` | 全部依赖在此装配，一次性完成注入 |
| **Strategy + Early Branching** | `ConfigManager` / `RendererManager` / `InteractionManager` | 设备类型仅判定 1 次，二叉后互不影响 |
| **Facade** | `MindMapService` | 向 View / Renderer 暴露高层 API，屏蔽 Handler 细节 |
| **Mediator** | `RendererCoordinator` | 协调 10+ 子模块，避免子模块两两耦合 |
| **Adapter** | `AIClient` | 适配 OpenAI 兼容 REST 协议 |
| **Memento** | `UndoManager` | 全量快照 + 深拷贝 + parent 重建 |
| **Observer/Callback** | Renderer → View、Feature → Coordinator | 反向依赖注入，避免 import 循环 |
| **Singleton** | `Logger` / `EncryptionUtil` / `AccessibilityUtil` | 全局工具类 |

---

## 4. 核心类图

```
MindMapPlugin ─── owns ──▶ ConfigManager
    │                       │
    │                       └── holds ── DesktopConfig | MobileConfig
    │
    ├── owns ──▶ MindMapService ─── uses ──▶ D3FileHandler
    │                │                        │
    │                │                        └── uses ──▶ parseMarkdownContent
    │                │
    │                ├── uses ──▶ LayoutCalculator
    │                └── uses ──▶ AIClient ─── uses ──▶ AIPrompts
    │
    ├── owns ──▶ AIClient
    │
    └── registers ──▶ MindMapView (per leaf)
                        │
                        └── owns ──▶ RendererManager
                                        │
                                        └── holds ── DesktopTreeRenderer | MobileTreeRenderer
                                                        │
                                                        └── owns ──▶ RendererCoordinator
                                                                │
                                                                ├── uses ──▶ TextMeasurer
                                                                ├── uses ──▶ LayoutCalculator
                                                                ├── uses ──▶ NodeRenderer / LinkRenderer / TextRenderer
                                                                ├── owns ──▶ InteractionManager
                                                                │              ├── owns ──▶ MouseInteraction
                                                                │              └── owns ──▶ KeyboardManager
                                                                ├── owns ──▶ NodeEditor
                                                                ├── owns ──▶ ClipboardManager
                                                                ├── owns ──▶ AIAssistant
                                                                ├── owns ──▶ ButtonRenderer
                                                                ├── owns ──▶ MobileToolbar (mobile only)
                                                                └── owns ──▶ UndoManager
```

---

## 5. 关键数据结构

### 5.1 `MindMapNode`（`interfaces/mindmap-interfaces.ts`）

```typescript
interface MindMapNode {
    text: string;
    level: number;                 // 0=根（文件名），依次递增
    parent: MindMapNode | null;
    children: MindMapNode[];
    expanded: boolean;
    selected?: boolean;
    hovered?: boolean;

    // 由 LayoutCalculator 写入的布局字段
    x?: number;                    // 布局坐标系：垂直中心
    y?: number;                    // 布局坐标系：水平左边缘
    nodeWidth?: number;
    nodeHeight?: number;
    subtreeWidth?: number;
    subtreeHeight?: number;

    // 展示扩展
    color?: string; icon?: string; link?: string;
}
```

**坐标系约定（全局）**：`x = 垂直中心`，`y = 水平左边缘`。此约定在 `LayoutCalculator`、`NodeRenderer`、`LinkRenderer`、`MobileToolbar` 中被严格共享，由 `CoordinateConverter` 提供转换封装。

### 5.2 `MindMapData`

```typescript
interface MindMapData {
    rootNode: MindMapNode;
    allNodes: MindMapNode[];       // 扁平化，O(1) 查询
    maxLevel: number;
}
```

### 5.3 `MindMapConfig`

```typescript
interface MindMapConfig {
    isMobile: boolean;
    language: 'en' | 'zh';
    layout: LayoutConfig;
    style: StyleConfig;
    color: ColorConfig;
    animation: AnimationConfig;
    performance: PerformanceConfig;
    interaction: InteractionConfig;
}
```

参见 [Config 模块设计](./modules/config.md)。

### 5.4 `EditingState`

```typescript
interface EditingState {
    isEditing: boolean;
    currentNode: HierarchyNode<MindMapNode> | null;
    originalText: string;
    editElement: HTMLDivElement | null;
}
```

在 `NodeEditor`、`TextRenderer`、`RendererCoordinator`、`InteractionManager`、`KeyboardManager` 之间共享**同一引用**（不重建对象），用作全局编辑门禁。

---

## 6. 关键算法

### 6.1 两阶段树布局（`LayoutCalculator.createCustomTreeLayout`）

**输入**：`d3.HierarchyNode<MindMapNode>` + 尺寸回调 `(depth, text) => {width, height}`。
**输出**：写入每个 `data` 的 `x/y/nodeWidth/nodeHeight/subtreeWidth/subtreeHeight`。
**复杂度**：O(N)（两次遍历）。

```
阶段 1  eachAfter (后序):
  ● 叶子：subtree* = node*
  ● 分支：
      subtreeWidth  = max(nodeWidth,   max(child.subtreeWidth))
      subtreeHeight = max(nodeHeight,  Σ child.subtreeHeight
                                       + verticalGap*(childCount-1))

阶段 2  递归前序 setNodePositionsTopDown:
  当前节点写入 (x, y)
  子节点组合总高 T = Σ child.subtreeHeight + gap
  currentY = parent.x - T/2
  for each child:
      childX = currentY + child.subtreeHeight/2
      childY = parent.y + parent.nodeWidth + horizontalSpacing
      currentY += child.subtreeHeight + verticalGap
```

**关键点**：
- 所有兄弟节点使用**相同**的 `childY`（左对齐父节点右缘 + 间距），产生规整的树形分栏。
- 根 → L1 使用 80 px 间距，其余层使用 30 px；自适应间距由 `calculateAdaptiveHorizontalSpacing` 按 SOURCE/TARGET 比例计算。

### 6.2 动态高度补偿（`RendererCoordinator.calculateDynamicTreeHeight`）

避免深层节点重叠。核心公式：

```
layerHeight(nodes) = max(nodeHeight for n in nodes) + min(avgLen*2, 50) [text-bonus]

depthMultiplier(d) = {0.8, 1.0, 1.3, 1.8, 2.2 + (d-4)*0.3}[d]
countMultiplier(n) = n > 3 ? 1 + (n-3)*0.1 : 1

totalHeight = Σ layer  layerHeight * depthMultiplier * countMultiplier
            + max(100, maxDepth * 25)
```

最终不低于 `layoutConfig.treeHeight`（800）。

### 6.3 连线路径（`LinkRenderer`）

- **根 → L1**：三次贝塞尔 `M sx,sy C c1,c2 t`，`C1_x = sx + Δx*0.3, C2_x = tx - Δx*0.3`。
- **其他层**：圆角折线，拐点在源右缘 + `Δx*0.45` 处，圆角半径 `= min(8, |Δx|*0.4, |Δy|*0.4)`。

### 6.4 AES-GCM 加密流程（`EncryptionUtil`）

```
① keyMaterial = importKey('raw', deviceInfo || 'obsidian-mindmap-plugin-fallback')
② key = PBKDF2(keyMaterial, salt='mindmap-plugin-salt-2024', iter=100_000, SHA-256)
                → AES-GCM-256
③ 加密：iv(12 random bytes) + subtle.encrypt(iv, key, plain) → base64(iv || ct)
④ 解密：base64 → iv(0..12) + ct(12..) → subtle.decrypt
```

`deviceInfo` 在 `main.ts` 中由 vault 名（`obsidian-mindmap-plugin-${vaultName}`）派生，**导致加密数据不能跨 vault 复用**。

### 6.5 Undo/Redo 快照（`UndoManager`）

```
saveSnapshot(data):
    clone = deepCloneNode(data.rootNode)      // parent 置 null 避免循环
    rebuildParentReferences(clone)            // 恢复 parent 链
    push undoStack; if len>5 shift; clear redoStack

undo(current):
    push clone(current) to redoStack
    return pop(undoStack)

redo(current):
    push clone(current) to undoStack
    return pop(redoStack)
```

栈上限 5；redoStack 在新的 `saveSnapshot` 中被清空。

### 6.6 Markdown ↔ 树（`mindmap-utils`）

**解析**（`parseMarkdownContent`）：

```
去掉 #mindmap 头
root = { text: fileName, level: 0 }
nodeStack = [root]
for each list line:
    level = floor(indent.length / 4) + 1
    while nodeStack.length > level: pop
    parent = top(nodeStack)
    node = { text, level, parent }
    parent.children.push(node); nodeStack.push(node)
```

**生成**（`generateMarkdownFromNodes`）：跳过 level 0；`indent = '    '.repeat(level-1)`；多行文本首行 `* text`、续行 `<indent>  <line>`。

### 6.7 双击判定（`MouseInteraction`）

```
isDoubleClick = (now - lastClickTime < 300ms) && (clickNode === node)
```

单击不使用延迟（立即触发选择），双击命中时不 `preventDefault`（保留浏览器光标定位）。

---

## 7. 关键流程

### 7.1 插件启动

```
Obsidian.load
  → MindMapPlugin.onload
      1. loadSettings（含 EncryptionUtil.decrypt API key）
      2. EncryptionUtil.initialize(vault-derived salt)
      3. Early Branching #1：deviceType 'auto' → Platform.isMobile
      4. new ConfigManager(isMobile, language)
      5. new AIClient(aiConfig)
      6. new MindMapService(app, config, settings, aiClient)
      7. new I18nManager(language)
      8. addRibbonIcon / addCommand / addSettingTab
      9. registerView(MIND_MAP_VIEW_TYPE, leaf => new MindMapView(...))
     10. on('file-open') → replaceWithMindMapView(file) if isMindMapFile
     11. on('file-menu') → 添加"新建脑图"
     12. onLayoutReady → 检测当前活动文件
```

### 7.2 文件打开 → 渲染

```
Obsidian file-open
  → MindMapPlugin.replaceWithMindMapView(file)
      → leaf.setViewState({ type: MIND_MAP_VIEW_TYPE, state:{filePath} })
        → MindMapView.setState()
          → loadFileContent()
            → mindMapService.loadMindMapData(file)
              → D3FileHandler.parseMarkdownToData
                → parseMarkdownContent → MindMapData
          → renderMindMap(content)
            → renderer.render(container, data)
              → RendererManager → Desktop/MobileTreeRenderer
                → RendererCoordinator.render
                  → LayoutCalculator.createCustomTreeLayout
                  → renderLinks (LinkRenderer)
                  → renderNodes (NodeRenderer + TextRenderer)
                    → InteractionManager.attachHandlers
                  → applyInitialViewPosition
                  → restoreSelectionUI
```

### 7.3 节点文本编辑

```
用户双击节点
  → MouseInteraction.handleNodeClick (双击命中)
    → callbacks.onNodeDoubleClick
      → InteractionManager → RenderCallbacks.onNodeDoubleClicked
        → RendererCoordinator.enterEditMode(node)
          → NodeEditor.enableEditing(node, div)
            ● setCanvasInteraction(false)
            ● 更新共享 EditingState
            ● contentEditable=true, 全选, focus
            ● 100ms 后 showEditingHint

用户按下 Enter / blur
  → TextRenderer 键盘处理 / setTimeout(150ms) blur
    → RendererCoordinator.saveNodeText
      → NodeEditor.saveText
        ● validate → text 未变则 exit
        ● onBeforeTextChange (undoManager.saveSnapshot)
        ● node.data.text = newText
        ● onTextChanged → View.handleNodeTextChanged (300ms 防抖)
          → refreshMindMapLayout + service.saveToMarkdownFile
            → D3FileHandler.saveToMarkdownFile
              → app.vault.process(file, () => newContent)
```

### 7.4 AI 建议

```
用户点击 ✨ 按钮
  → AIAssistant.triggerSuggestions(node)
    → mindMapService.suggestChildNodes(node.data)
      ● 构造 NodeContext { nodeText, level, parent, siblings, existingChildren, centralTopic }
      → AIClient.suggestChildNodes(context, template, sys)
        → AIPrompts.buildUserPrompt(template, context)
        → chat(prompt, sys) → requestUrl POST /chat/completions
        → validateAPIResponseStructure
        → parseJSONResponse
        → deduplicateSuggestions (vs existingChildren)  → top 5
    ← string[]
  → 弹出 .ai-suggestions-panel
    ● 单击 item → createChildNode + 打勾
    ● Add All  → 循环 createChildNode
    ● onNodeCreated → triggerDataUpdate → 重新渲染 + 存盘
```

### 7.5 Undo / Redo

```
Ctrl+Z (KeyboardManager)
  → RenderCallbacks.onUndo
    → RendererCoordinator.undo
      → undoManager.undo(currentData) → previousData
      ● 就地改写 currentData 引用（rootNode/allNodes/maxLevel）
      ● clearSelection
      ● onDataRestored(previousData) → View.handleDataRestored
        ● 替换 mindMapData 引用
        ● refreshMindMapLayout
        ● saveToMarkdownFile
```

---

## 8. 门禁与冲突

`canvasInteractionEnabled` 与 `editingState.isEditing` 是全局的两道门禁，防止各交互模块相互踩踏：

| 场景 | canvasInteraction | 节点点击 | Zoom | 编辑 |
|---|---|---|---|---|
| 空闲 | ✅ | ✅ | ✅ | — |
| 节点编辑中 | ❌ | 部分（同节点忽略，跨节点触发 blur） | ❌ | ✅ |
| 拖拽中（规划中） | ❌ | ❌ | ❌ | ❌ |

`KeyboardManager` 编辑态下仅放行 Ctrl+C/X/V，其他快捷键静默阻断。

---

## 9. 性能策略

| 项 | 策略 |
|---|---|
| 渲染重入 | `isRendering` 锁 + `pendingRenderRequest` 挂起队列，16ms 后 flush |
| 文本测量 | 双层缓存（原始 measure + 节点级 dimensions），key 含 text/font 或 depth/text/len |
| 保存 | View 层 300ms 防抖 `handleNodeTextChanged` |
| 视口塌陷（iPad 键盘）| ResizeObserver + Sticky-max：SVG 尺寸只增不减 |
| Undo 栈 | 上限 5，深拷贝但不含 DOM |
| AI 响应超时 | testConnection 10s；建议无显式超时（依赖 requestUrl） |
| Log Buffer | 上限 1000 条 LRU |

**未做的优化**（后续可考虑）：R-tree 空间索引、虚拟化渲染（`MAX_NODES_BEFORE_VIRTUALIZATION=500` 已埋点未启用）。

---

## 10. 安全设计

1. **API Key 加密**：AES-GCM 256 + PBKDF2 10万次；salt 固定但 keyMaterial 与 vault 名绑定。
2. **URL 白名单**：`AIClient.validateConfiguration` 强制 https，仅允许 localhost/127.0.0.1 用 http。
3. **响应校验**：`validateAPIResponseStructure` 逐字段检查，防止 `undefined.content` 崩溃。
4. **文本长度限制**：`VALIDATION_CONSTANTS.MAX_TEXT_LENGTH=500`，`MAX_FILE_SIZE=1MB`。
5. **无外部依赖执行**：AI 返回不做 `eval`，仅按 JSON 数组或换行解析。
6. **敏感数据日志**：Logger 的 `jsonReplacer` 剥离 `MindMapNode.parent` 循环引用，未对 API key 做特别处理（用户责任：debug 模式不上传日志）。

---

## 11. 可扩展点

| 需求 | 扩展点 |
|---|---|
| 新增设备形态（如 TV/大屏） | 新增 `TVConfig`，扩展 `ConfigManager` |
| 更换渲染引擎（Canvas / WebGL） | 实现 `MindMapRenderer` 接口，插入 `RendererManager` |
| 新的 AI 提供商 | `AIClient` 添加分支 or 抽象为策略 |
| 新的编辑操作（如剪切子树） | 在 `RendererCoordinator.RenderCallbacks` 加事件；`KeyboardManager` 加路由 |
| 新的持久化格式（OPML/JSON）| 扩展 `D3FileHandler` + `mindmap-utils` 的 parse/generate |

---

## 12. 已知设计权衡

| 权衡 | 现状 | 备选 |
|---|---|---|
| 全量快照 vs 差分 Undo | 快照（简单，栈上限 5） | Command 模式（后续 >5 层历史时再切换） |
| 深拷贝重建 parent vs Weak 引用 | 每次 clone 重建 | 使用 immutable 树 |
| 布局坐标转置（x/y 反直觉）| 保留（历史遗留） | 后续重命名为 `centerY/leftX` |
| 4 空格 = 1 层 | 硬编码 | 允许 tab/2 空格（增加解析歧义） |
| 无虚拟化 | > 500 节点性能待验证 | Canvas + 视口裁剪 |
| Desktop/Mobile Renderer 差异极小 | 目前仅 CSS class | 后续可完全独立 |

---

## 13. 文件与目录

```
src/
├── main.ts                    ── Composition Root
├── interfaces/                ── 全项目共享类型
├── config/                    ── Strategy: Desktop/Mobile 配置分叉
├── constants/                 ── 常量（尺寸、颜色、动画、性能）
├── services/                  ── Facade: MindMapService
├── handlers/                  ── 底层 I/O 与交互（部分为遗留）
├── managers/                  ── UndoManager
├── renderers/                 ── D3 视图层（Coordinator + 子渲染器）
│   └── core/                  ── NodeRenderer / LinkRenderer / TextRenderer
├── interactions/              ── 交互层（Mouse/Keyboard + Manager）
├── features/                  ── 高级特性（AI/编辑/剪贴板/工具栏/按钮）
├── utils/                     ── 无状态工具（加密、坐标、日志、测量、i18n）
└── i18n/                      ── en / zh 字典 + 变量替换
```

---

## 14. 子模块设计文档索引

- [Config 模块](./modules/config.md)：设备分叉与配置策略
- [Service / Handler 模块](./modules/service-handler.md)：Facade 与文件 I/O
- [Renderer 模块](./modules/renderer.md)：布局算法、SVG 生成、坐标系
- [Interaction 模块](./modules/interaction.md)：Mouse / Keyboard 与事件门禁
- [Feature 模块](./modules/feature.md)：AI / Editor / Clipboard / Toolbar / Button / Undo
- [Utils 模块](./modules/utils.md)：加密、坐标、测量、日志、i18n
- [节点拖拽设计（规划中）](./node-drag-design.md)

---

**文档结束**
