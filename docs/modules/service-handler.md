# Service / Handler 模块设计

> **范围**：`src/services/mindmap-service.ts`、`src/handlers/*`、`src/managers/UndoManager.ts`
> **模式**：Facade + Memento
> **依赖**：`obsidian.App`、`AIClient`、`mindmap-utils`（解析/生成）

---

## 1. 模块职责

- **`MindMapService`**：单一门面，向 View / Renderer 暴露高层数据操作 API。
- **Handler 层**：拆分底层职责（文件、状态、交互），大部分现在被 Coordinator/Manager 承接，仅 `D3FileHandler` 仍在活跃使用。
- **`UndoManager`**：全量快照式撤销/重做，独立于 Service（由 Coordinator 持有）。

---

## 2. `MindMapService`（Facade）

### 2.1 关键字段

```typescript
class MindMapService {
    private app: App;
    private fileHandler: D3FileHandler;
    private layoutCalculator: LayoutCalculator;
    private config: MindMapConfig;
    private settings?: MindMapSettings;
    private aiClient?: AIClient;
    private messages: MindMapMessages;
}
```

**构造**：`constructor(app, config, settings?, aiClient?)`；内部实例化 Handler 与 LayoutCalculator。

### 2.2 API 分组

#### 文件层
```typescript
async isMindMapFile(file: TFile): Promise<boolean>
async loadMindMapData(file: TFile): Promise<MindMapData>
async saveMindMapData(filePath, rootNode): Promise<void>          // alias: saveToMarkdownFile
async createMindMapFile(filePath, title): Promise<TFile>
fileExists(filePath): boolean
```

#### 解析层
```typescript
parseMarkdownToNodes(content): MindMapNode[]
parseMarkdownToData(content, filePath): MindMapData
generateMarkdownFromNodes(rootNode): string
serializeSubtreeToMarkdown(rootNode): string    // 用于剪贴板
createSubtreeFromMarkdown(markdown, parentLevel): MindMapNode | null
```

#### 节点操作
```typescript
createChildNode(parentNode, childText='New Node'): MindMapNode
createSiblingNode(afterNode, siblingText='New Node'): MindMapNode | null
deleteNode(nodeToDelete): boolean            // level=0 拒绝并 Notice
updateAllNodesArray(rootNode): MindMapNode[] // 先序遍历重建扁平索引
```

#### AI 集成
```typescript
async suggestChildNodes(node: MindMapNode): Promise<string[]>
```

**流程**：
```
① 组装 NodeContext
   {
     nodeText: node.text,
     level: node.level,
     parent: node.parent?.text,
     siblings: parent.children.filter(!=node).map(text),
     existingChildren: node.children.map(text),
     centralTopic: 沿 parent 上溯至 root 的 text
   }
② aiClient.suggestChildNodes(context, systemMessage, promptTemplate)
③ 返回去重后的 string[]（最多 5 条）
```

#### 生命周期
```typescript
updateSettings(settings, aiClient): void
updateLanguage(language: 'en' | 'zh'): void   // 重新 createI18nManager
getLayoutCalculator() / getFileHandler() / getAIClient()
```

### 2.3 关键私有算法

**`serializeSubtreeToMarkdown`**：
- 缩进 `'    '.repeat(depth - startDepth)`，`* text` 前缀。
- **注意**：与 `generateMarkdownFromNodes` 的实现不同（本方法用于子树复制粘贴，不包含 `#mindmap` 头）。

**`createSubtreeFromMarkdown`**：
- 基于 `nodeStack` 重建；`level = floor(indent / 4) + 1 + parentLevel`。
- 解析失败返回 null，由调用方降级为纯文本粘贴。

### 2.4 校验规则

`deleteNode`：
- `node.level === 0` → Notice(`cannotDeleteRoot`) + return false。
- `node.parent === null` → Notice + return false。

`createSiblingNode`：
- root（`level === 0`）→ Notice + return null。

---

## 3. `D3FileHandler`（文件 I/O）

```typescript
class D3FileHandler implements MindMapFileHandler {
    constructor(private app: App);

    async isMindMapFile(file: TFile): Promise<boolean>;
    async loadFileContent(file: TFile): Promise<string>;
    parseMarkdownToNodes(content): MindMapNode[];
    parseMarkdownToData(content, filePath): MindMapData;
    async saveToMarkdownFile(filePath, rootNode): Promise<void>;
    async createMindMapFile(filePath, title): Promise<TFile>;
    fileExists(filePath): boolean;
}
```

### 关键点

- **原子写**：`app.vault.process(file, () => newContent)`，避免并发写导致数据损坏。
- **新文件初始内容**：`"#mindmap\n\n* ${title}\n"`。
- **文件识别**：`isMindMapFile(content, extension)` 判定扩展名为 `md` 且首非空行为 `#mindmap`。
- **委托解析**：所有 Markdown 解析走 `mindmap-utils.parseMarkdownContent`。

---

## 4. `MindMapStateHandlerImpl`（状态持有，遗留）

```typescript
interface ViewState {
    file: string | null;
    zoomTransform?: d3.ZoomTransform;
    scrollPosition?: { x: number; y: number };
}
```

**状态**：Phase 1 遗留类，主流程未直接使用（`MindMapView` 自己保存 `filePath`，视图变换由 `RendererCoordinator.currentZoomTransform` 持有）。**保留以备未来抽出。**

---

## 5. `D3InteractionHandler`（交互，遗留）

Phase 1 遗留的节点点击/双击/编辑处理器，现由 `InteractionManager` + `NodeEditor` 替代。仅 `DesktopInteraction` / `MobileInteraction` 包装类还引用，但 `RendererCoordinator` 已不使用。

---

## 6. `UndoManager`（Memento）

### 6.1 类结构

```typescript
class UndoManager {
    private undoStack: MindMapData[] = [];
    private redoStack: MindMapData[] = [];
    private readonly MAX_STACK_SIZE = 5;

    saveSnapshot(data: MindMapData): void;
    undo(currentState: MindMapData): MindMapData | null;
    redo(currentState: MindMapData): MindMapData | null;
    canUndo() / canRedo(): boolean;
    getUndoCount() / getRedoCount(): number;
    clearHistory(): void;
}
```

### 6.2 快照算法（关键）

```
saveSnapshot(data):
    root'   = deepCloneNode(data.rootNode)       // 递归 clone；parent 全置 null
    rebuildParentReferences(root')               // DFS 恢复 parent 链
    allNodes' = flatten(root')
    snapshot = { rootNode: root', allNodes': ..., maxLevel: ... }
    undoStack.push(snapshot)
    if undoStack.length > 5: undoStack.shift()
    redoStack = []
```

**为何要重建 parent**：JSON.stringify 无法克隆循环引用；直接 structuredClone 也不适合（会保留 DOM/Set/Map 等异构结构）。方案是：clone 时先切断 parent，再 DFS 重建，保证深拷贝后的树结构自洽。

### 6.3 Undo / Redo

```
undo(current):
    redoStack.push(clone(current))
    return undoStack.pop()

redo(current):
    undoStack.push(clone(current))
    return redoStack.pop()
```

### 6.4 使用点

由 `RendererCoordinator` 在**结构变更前**调用 `saveSnapshot`：
- `handleAddChildNode` / `handleAddSiblingNode`
- `handleDeleteNode`
- `NodeEditor.onBeforeTextChange` 回调
- `ClipboardManager.pasteToNode`（内部先创建再委托 service，快照由 Coordinator 层统一保存）

**恢复通道**：`renderer.onDataRestored(previousData)` → `View.handleDataRestored` → 替换 `mindMapData` → `refreshMindMapLayout` + 存盘。

### 6.5 局限与后续

| 局限 | 备选 |
|---|---|
| 全量快照，节点多时内存占用高 | Command 模式（记录 op + 参数） |
| 栈上限 5 | 提升到 20（预算内存后可行） |
| 不区分变更类别 | 分组合并连续同类操作（如连续输入） |

---

## 7. 协作图

```
MindMapView / Coordinator
    │
    ├── mindMapService.loadMindMapData ─▶ D3FileHandler.parseMarkdownToData
    │                                       └─▶ parseMarkdownContent
    │
    ├── mindMapService.saveMindMapData ─▶ D3FileHandler.saveToMarkdownFile
    │                                       └─▶ generateMarkdownFromNodes
    │                                       └─▶ app.vault.process
    │
    ├── mindMapService.createChildNode
    ├── mindMapService.deleteNode
    ├── mindMapService.serializeSubtreeToMarkdown
    ├── mindMapService.suggestChildNodes ─▶ AIClient.suggestChildNodes
    │
    └── undoManager.saveSnapshot / undo / redo
```

---

## 8. 常见任务扩展点

| 任务 | 修改点 |
|---|---|
| 支持导出 OPML | `MindMapService.serialize*` 加分支；或新增 `OpmlFileHandler` |
| 支持导入 Freemind (`.mm`) | 新增 handler + `MindMapService.import*` |
| 支持移动节点（拖拽） | `MindMapService.moveNodeToPosition`（见 `node-drag-design.md`） |
| Batch 操作 | Coordinator 一次 `saveSnapshot` 包裹多个 service 调用 |

---

**文档结束**
