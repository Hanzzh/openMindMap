# Config 模块设计

> **范围**：`src/config/*`、`src/constants/mindmap-constants.ts`
> **模式**：Strategy + Early Branching
> **依赖**：无（仅被上层依赖）

---

## 1. 模块职责

- 提供**唯一**的设备类型判定入口。
- 将桌面 / 移动端的差异集中在两个策略类，避免代码中散落 `if (isMobile)` 检查。
- 提供不可变的 `MindMapConfig` 快照供全项目消费。

## 2. 核心类

### 2.1 `ConfigManager`（`src/config/config-manager.ts`）

```typescript
class ConfigManager {
    constructor(isMobile: boolean, language: 'en' | 'zh' = 'en');

    getConfig(): MindMapConfig;
    updateLanguage(lang: 'en' | 'zh'): void;    // 唯一可变属性
    isMobile(): boolean;

    // 分组 getter（供 renderer/interaction 细粒度消费）
    getLayoutConfig() / getStyleConfig() / getColorConfig()
    getAnimationConfig() / getPerformanceConfig() / getInteractionConfig()
}
```

**构造时机**：`MindMapPlugin.onload()` 唯一处。
**不可变性**：`config: MindMapConfig` 仅通过 `updateLanguage` 改动 `language` 字段；其他属性构造后不再变更。

### 2.2 `DesktopConfig` / `MobileConfig`

- `DesktopConfig` 是配置基线，全部值取自 `constants/mindmap-constants.ts`。
- `MobileConfig` 通过 `new DesktopConfig().getConfig()` 得到 base，再覆写差异字段。

**差异一览**（关键项）：

| 项 | Desktop | Mobile | 说明 |
|---|---|---|---|
| `layout.minNodeGap` | 25 | 20 | 移动更紧凑 |
| `layout.horizontalSpacing` | 220 | 154 | -30% |
| `layout.verticalSpacing` | 110 | 88 | -20% |
| `adaptiveHorizontalSpacing.*` | — | 均缩放 -30% | 保持比例 |
| `style.level1FontSize` | 18px | 19px | 移动端更大 |
| `style.defaultFontSize` | 15px | 16px | 移动端更大 |
| `animation.fastTransition` | 150 | 100 | 更快响应 |
| `performance.renderDebounceDelay` | 100 | 150 | 更保守 |
| `performance.inputDebounceDelay` | 300 | 400 | 更保守 |
| `interaction.touchTargetSize` | — | 44 | iOS HIG 标准 |
| `interaction.enableTouchGestures` | — | true | pinch/touch drag |

## 3. 关键数据结构

### 3.1 `MindMapConfig`（`types.ts`）

```typescript
interface MindMapConfig {
    isMobile: boolean;
    language: SupportedLanguage;
    layout: LayoutConfig;             // 间距/画布尺寸/自适应间距
    style: StyleConfig;               // 字号/最小宽/字宽比
    color: ColorConfig;               // 各级色/hover/选中/连线
    animation: AnimationConfig;       // 三档过渡时间 + 缓动
    performance: PerformanceConfig;   // 虚拟化阈值、防抖、缓存
    interaction: InteractionConfig;   // enableDrag/Zoom, scaleExtent, touchTargetSize
}
```

### 3.2 `LayoutConfig.adaptiveHorizontalSpacing`

```typescript
{
    minSpacing: number;      // 桌面 80 / 移动 56
    maxSpacing: number;      // 桌面 300 / 移动 210
    sourceNodeRatio: number; // 0.15  → 源节点宽度权重
    targetNodeRatio: number; // 0.10  → 目标节点宽度权重
    baseSpacing: number;     // 桌面 60 / 移动 42
    safetyMargin: number;    // 10
}
```

`LayoutCalculator.calculateAdaptiveHorizontalSpacing(sw, tw)` 消费此结构（当前使用硬编码值，Phase 2 会切换到 config 驱动）。

### 3.3 `PerformanceConfig`

```typescript
{
    maxNodesBeforeVirtualization: 500;    // 埋点，未启用
    renderDebounceDelay: number;
    inputDebounceDelay: number;
    maxCacheSize: 1000;
    cacheExpiryTime: 300_000;             // 5 分钟
}
```

## 4. 常量层（`mindmap-constants.ts`）

**分组常量**：
- `LAYOUT_CONSTANTS`
- `STYLE_CONSTANTS`（含 `getFontSizeByDepth`、`getNumericFontSizeByDepth`）
- `COLOR_CONSTANTS`
- `ANIMATION_CONSTANTS`
- `PERFORMANCE_CONSTANTS`
- `DOM_CONSTANTS`
- `VALIDATION_CONSTANTS`

**关键常量**：
- `MIND_MAP_VIEW_TYPE = "mind-map-view"`：view 注册 ID
- `MINDMAP_IDENTIFIER = "#mindmap"`：文件识别前缀
- `MAX_TEXT_LENGTH = 500`：节点文本硬上限
- `MAX_FILE_SIZE = 1MB`：文件大小上限
- `INVALID_CHARACTERS = ['\t']`：禁用字符

**字号函数**：
```typescript
getFontSizeByDepth(depth: number): string;
// depth=0 → ROOT_FONT_SIZE (20px)
// depth=1 → LEVEL_1_FONT_SIZE (18px on desktop / 19px mobile)
// else    → DEFAULT_FONT_SIZE (15px / 16px mobile)
```

## 5. 使用约定

### ✅ 正确用法

```typescript
class MyRenderer {
    constructor(private config: MindMapConfig) {}
    render() {
        const size = this.config.style.rootFontSize;
        if (this.config.isMobile) {   // 允许！config.isMobile 是唯一的判定源
            useTouchDefault();
        }
    }
}
```

### ❌ 反面用法

```typescript
// 禁止在初始化之外使用 Platform.isMobile
if (Platform.isMobile) { /* ... */ }
// 禁止运行时切换 config（除 language）
config.isMobile = true;
```

## 6. 语言切换（唯一运行时可变）

`ConfigManager.updateLanguage()` → 由 `MindMapService.updateLanguage()` 转发 → 影响 `messages`（`I18nManager`）。**不影响布局/样式**。

## 7. 与其他模块协作

| 消费者 | 用途 |
|---|---|
| `MindMapService` | 语言、config 传递 |
| `RendererManager` / `InteractionManager` | 依 `isMobile` 分叉 |
| `NodeEditor` | 根据 `isMobile` 决定编辑提示文案 |
| `KeyboardManager` | 移动端禁用剪贴板/undo 快捷键 |
| `RendererCoordinator` | 布局/样式/动画/性能常量 |

## 8. 演进空间

- **Phase 2 目标**：将 `D3FileHandler` / `LayoutCalculator` / `MindMapService` 内部硬编码值全部迁到 `config` 驱动（现有 TODO 已标注）。
- **多设备支持**：`ConfigManager` 构造改为接受设备枚举（`'desktop' | 'mobile' | 'tv' | …`），策略类做工厂选择。
- **用户自定义配置**：暴露部分字段到设置面板（例如 `horizontalSpacing`）。

---

**文档结束**
