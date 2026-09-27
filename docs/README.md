# openMindMap 设计文档

本目录包含 openMindMap 插件的设计文档，涵盖整体架构、各模块详细设计与专项特性方案。

## 阅读顺序建议

1. **[架构总览](./architecture.md)** — 先读这一篇。分层、模式、关键数据结构、算法、跨模块流程一览。
2. **模块详细设计**（`modules/`）— 按需深入具体模块。
3. **专项设计**（如拖拽）— 针对某项功能的完整方案。

## 文档索引

### 架构文档

| 文档 | 主题 |
|---|---|
| [architecture.md](./architecture.md) | 全局架构、分层、类图、关键数据结构与算法、跨模块流程 |

### 模块设计（`modules/`）

| 文档 | 覆盖源码 | 关键内容 |
|---|---|---|
| [config.md](./modules/config.md) | `src/config/*`、`src/constants/*` | Strategy 模式、桌面/移动分叉、`MindMapConfig` 结构 |
| [service-handler.md](./modules/service-handler.md) | `src/services/*`、`src/handlers/*`、`src/managers/UndoManager.ts` | Facade（MindMapService）、文件 I/O、Memento（UndoManager） |
| [renderer.md](./modules/renderer.md) | `src/renderers/*`、`src/renderers/core/*` | 坐标系约定、两阶段布局、连线算法、Coordinator |
| [interaction.md](./modules/interaction.md) | `src/interactions/*` | 双击判定、键盘路由、门禁矩阵 |
| [feature.md](./modules/feature.md) | `src/features/*` | AI 建议、编辑、剪贴板、按钮、移动工具栏 |
| [utils.md](./modules/utils.md) | `src/utils/*`、`src/i18n/*` | AES-GCM 加密、坐标转换、文本测量、Markdown 解析、日志、i18n |

### 专项设计

| 文档 | 状态 | 主题 |
|---|---|---|
| [node-drag-design.md](./node-drag-design.md) | 规划中 | 节点拖拽移动的完整方案：状态机、命中检测、坐标反算、Undo 集成 |

## 关键约定速查

- **坐标系**：布局系 `node.x = 垂直中心, node.y = 水平左边缘`（历史遗留自 D3 tree layout 转置）。全项目共享，转换封装在 `utils/coordinate-system.ts`。
- **早期分支**：设备类型仅在 `MindMapPlugin.onload()` 中判定 1 次，此后通过 `config.isMobile` 只读。禁止在运行时使用 `Platform.isMobile`。
- **依赖注入**：全部通过构造函数注入；`main.ts` 是唯一 Composition Root。
- **Markdown 格式**：文件首行 `#mindmap`；4 空格 = 1 层缩进；仅支持无序列表 `*`/`-`/`+`。
- **Undo 快照**：`UndoManager` 全量快照 + 深拷贝 + parent 重建；栈上限 5。
- **API Key 存储**：AES-GCM 256 + PBKDF2 10 万次，绑定 vault 名；`EncryptionUtil.initialize` 在 `onload` 中调用一次。

## 文档维护

- 修改代码时请同步更新对应模块文档中的**关键数据结构**与**算法**部分。
- 新增大特性时新建 `docs/<feature-name>-design.md` 并在此索引中登记。
- 架构层改动时更新 [architecture.md](./architecture.md)。
