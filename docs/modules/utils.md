# Utils 模块设计

> **范围**：`src/utils/*`、`src/i18n/*`
> **模式**：静态工具类（Singleton / Pure Function）
> **依赖**：Web Crypto、DOM、Obsidian.requestUrl、`constants`

---

## 1. 模块职责

`utils/` 与 `i18n/` 提供全项目共用的**无状态或单例**能力：加密、坐标转换、文本测量、Markdown 解析、日志、无障碍播报、多语言。

## 2. 分组

```
utils/
├── encryption.ts           ── AES-GCM 加密 API Key
├── coordinate-system.ts    ── 布局↔画布坐标转换
├── font-size-manager.ts    ── 字号统一入口
├── TextMeasurer.ts         ── 高精度文本测量 + 双层缓存
├── mindmap-utils.ts        ── Markdown 解析/生成 + 树工具 + 校验
├── ai-client.ts            ── OpenAI 兼容 API 客户端
├── ai-prompts.ts           ── AI Prompt 模板变量替换
├── logger.ts               ── 单例日志 + 剪贴板导出
└── accessibility.ts        ── ARIA live region 屏幕阅读器

i18n/
├── types.ts                ── MindMapMessages、SupportedLanguage
├── i18n-manager.ts         ── I18nManager (点分路径 + 变量替换)
├── en.ts / zh.ts           ── 字典
└── index.ts                ── 模块出口
```

---

## 3. `EncryptionUtil` — AES-GCM 加密

### 3.1 API

```typescript
class EncryptionUtil {
    static initialize(deviceInfo: string): void;
    static encrypt(text: string): Promise<string>;      // → base64
    static decrypt(encryptedData: string): Promise<string>;
    static isEncrypted(text: string): boolean;          // 启发式：长度>50 且匹配 base64 pattern
}
```

### 3.2 关键字段

```
keyPromise: Promise<CryptoKey> | null    // 单例缓存派生密钥
deviceInfo: string                        // 由 main.ts 注入，通常为 `obsidian-mindmap-plugin-${vaultName}`
salt: string = 'mindmap-plugin-salt-2024' // 固定 salt
fallback: 'obsidian-mindmap-plugin-fallback'
```

### 3.3 密钥派生

```
① keyMaterial = subtle.importKey('raw', UTF8(deviceInfo), {name:'PBKDF2'}, false, ['deriveKey'])
② key = subtle.deriveKey(
        { name:'PBKDF2', salt: UTF8(salt), iterations: 100_000, hash:'SHA-256' },
        keyMaterial,
        { name:'AES-GCM', length:256 },
        false, ['encrypt','decrypt']
    )
```

10 万次 PBKDF2 迭代，SHA-256 哈希，输出 AES-GCM 256 密钥。

### 3.4 加解密流程

```
encrypt(plain):
    iv = crypto.getRandomValues(new Uint8Array(12))
    ct = await subtle.encrypt({name:'AES-GCM', iv}, key, UTF8(plain))
    combined = iv ‖ ct
    return base64(combined)

decrypt(b64):
    combined = base64Decode(b64)
    iv = combined.slice(0, 12)
    ct = combined.slice(12)
    plain = await subtle.decrypt({name:'AES-GCM', iv}, key, ct)
    return UTF8Decode(plain)
```

**错误**：解密失败抛 `Failed to decrypt API key. Please re-enter your API key in settings.`，同时 `Logger.error`。

### 3.5 安全性 / 局限

- **绑定 vault**：`deviceInfo` 派生自 vault 名，跨 vault 无法解密。
- **不防拷贝 data.json**：同 vault 的攻击者可读到密文并用同 vault 名解密。
- **salt 固定**：如果所有用户 salt 相同，理论上可预计算 rainbow table；但 10 万次迭代已经足够慢。
- **推荐**：将 `deviceInfo` 中融入更多熵源（e.g. install-id）。

---

## 4. `CoordinateConverter` — 坐标转换

### 4.1 API

```typescript
class CoordinateConverter {
    static toCanvasX(layoutY, offsetX=0): number;
    static toCanvasY(layoutX, nodeHeight, offsetY=0): number;
    static toLayoutX(canvasY, nodeHeight, offsetY=0): number;

    static toRightEdge(layoutY, nodeWidth, padding, lineOffset, offsetX=0): number;
    static toLeftEdge(layoutY, padding, lineOffset, offsetX=0): number;

    static getNodeBounds(canvasX, canvasY, w, h): { x, y, right, bottom, width, height };
    static getVerticalDistance(layoutX1, layoutX2): number;
    static isOverlapping(layoutX1, h1, layoutX2, h2, gap=0): boolean;
    static createTransform(layoutX, layoutY, w, h, offsetX, offsetY): string;
    static calculateActualGap(x1, h1, x2, h2): number;
}
```

### 4.2 坐标系约定（全项目必读）

| 系统 | X | Y |
|---|---|---|
| **布局系** (LayoutCalculator 输出) | 垂直中心 (`node.x`) | 水平左边缘 (`node.y`) |
| **画布系** (SVG 渲染) | 水平从左至右 | 垂直顶边至下 |

**转换公式**：

```
canvasX = layoutY + offsetX
canvasY = layoutX + offsetY − nodeHeight/2
```

**逆变换**：

```
layoutX = canvasY + nodeHeight/2 − offsetY
```

### 4.3 关键方法：连线端点

- **父节点右缘**：`toRightEdge(source.y, sourceWidth, sourcePadding, lineOffset, offsetX)`
  → `layoutY + nodeWidth + padding + lineOffset + offsetX`
- **子节点左缘**：`toLeftEdge(target.y, targetPadding, lineOffset, offsetX)`
  → `layoutY − padding − lineOffset + offsetX`

`lineOffset = 6` 让连线不紧贴节点边框。

### 4.4 关键方法：重叠检测

```
isOverlapping(x1, h1, x2, h2, gap=0):
    top1 = x1 - h1/2; bottom1 = x1 + h1/2
    top2 = x2 - h2/2; bottom2 = x2 + h2/2
    return !(bottom1 + gap < top2 || bottom2 + gap < top1)
```

---

## 5. `TextMeasurer` — 高精度文本测量

### 5.1 API

```typescript
class TextMeasurer {
    measureTextAccurately(text, fontSize, fontWeight='normal'): { width, height };
    wrapText(text, maxWidth: number|null, fontSize): string[];
    measureTextSize(lines, fontSize, fontWeight='normal'): { width, height };
    getNodeDimensions(depth: number, text: string): NodeDimensions;
    clearNodeDimensionsCacheForText(text): void;
    destroy(): void;
}

interface NodeDimensions {
    width, height, textX, textY,
    fontSize, fontWeight,
    lines: string[],
    padding, minWidth, maxWidth,
}
```

### 5.2 双层缓存

```
textMeasurementCache: Map<string, {width, height}>
    key = `${text}-${fontSize}-${fontWeight}`

nodeDimensionsCache: Map<string, NodeDimensions>
    key = `${depth}-${text}-${text.length}`
```

`clearNodeDimensionsCacheForText(text)` 遍历两个 Map 清除包含 `text` 的 key。

### 5.3 测量原理

隐藏 DOM `<div class="mindmap-text-measurer">` 懒创建，设置 fontSize/fontWeight/textContent，读 `getBoundingClientRect()`。失败降级到估算：`charWidth = fontSize * 0.62, lineHeight = fontSize * 1.2`。

### 5.4 节点尺寸分级

| depth | fontSize | fontWeight | minWidth | padding |
|---|---|---|---|---|
| 0 (root) | `getFontSizeByDepth(0)` | bold | 40 | 18 |
| 1 | `getFontSizeByDepth(1)` | bold | 38 | 16 |
| ≥2 | `getFontSizeByDepth(depth)` | normal | 20 | 10 |

```
safetyBuffer = max(8, textWidth * 5%)
width  = max(textWidth + padding*2 + safetyBuffer, minWidth)
height = max(textHeight + padding*2, fontSize * 2.0)
textX  = width / 2
textY  = textHeight / 2 + padding / 2
```

`maxWidth = null` 表示**允许自适应无换行**（配合 TextRenderer 的 `white-space: pre`）。

---

## 6. `mindmap-utils` — 纯函数工具库

### 6.1 Markdown 解析（关键）

```
parseMarkdownContent(content, filePath):
    去掉 #mindmap 头
    root = { text: fileName, level: 0 }
    nodeStack = [root]
    for each list line:
        parsed = parseListItem(line)
        level = parsed.level + 1
        while nodeStack.length > level: pop
        parent = top(nodeStack)
        node = { text: parsed.content, level, parent, children: [] }
        parent.children.push(node)
        nodeStack.push(node)
        lastNode = node
        lastIndentLength = parsed.indent.length
    # 续行处理：非列表行且缩进 > lastIndentLength → lastNode.text += '\n' + trimmed
    return { rootNode: root, allNodes, maxLevel }

parseListItem(line):
    match /^(\s*)([*\-+]?\d*\.?)\s+(.+)$/
    level = floor(indent.length / 4)         # 4 空格 = 1 层
    content = cleanTextContent(g3)
```

### 6.2 Markdown 生成

```
generateMarkdownFromNodes(rootNode):
    output = "#mindmap\n\n"
    dfs(node, indentLevel):
        if indentLevel > 0:                  # 跳过 level 0 (文件名)
            indent = '    '.repeat(indentLevel - 1)
            lines = node.text.split('\n')
            output += `${indent}* ${lines[0]}\n`
            for line in lines.slice(1):
                output += `${indent}  ${line}\n`   # 对齐 * 后 2 空格
        for child in node.children:
            dfs(child, indentLevel + 1)
    dfs(rootNode, 0)
```

### 6.3 校验

```
validateNodeText(text):
    text.trim() !== '' &&
    text.length ≤ MAX_TEXT_LENGTH (500) &&
    ¬ INVALID_CHARACTERS.some(ch => text.includes(ch))
```

### 6.4 树操作

```
getNodeDescendants(node) → 所有后代（DFS 展开）
getNodeAncestors(node)   → 沿 parent 上溯
isNodeDescendant(parent, child) → 递归判定
```

### 6.5 性能工具

```
debounce<T>(fn, wait): (…args) => void
throttle<T>(fn, limit): (…args) => void
```

### 6.6 文件识别

```
isMindMapFile(content, extension):
    extension === 'md' && content.trimStart().startsWith('#mindmap')
```

---

## 7. `AIClient` — OpenAI 兼容 API 客户端

### 7.1 API

```typescript
class AIClient {
    constructor(config: AIConfiguration);
    updateConfig(config): void;

    testConnection(): Promise<TestConnectionResult>;
    chat(userMessage, systemMessage?): Promise<string>;
    suggestChildNodes(context: NodeContext, promptTemplate, systemMessage): Promise<string[]>;
    isConfigured(): boolean;
}

interface AIConfiguration { apiBaseUrl, apiKey, model }
interface TestConnectionResult { success, message }
```

### 7.2 HTTP 层

- 使用 Obsidian `requestUrl`（**绕过浏览器 CORS 限制**）。
- POST `${baseUrl}/chat/completions`。
- Bearer 认证；`max_tokens: 10`（testConnection）/ `3000`（chat）；`temperature: 0.7`。
- 错误映射：401→认证失败详细指引；429→限流；其他→通用错误。

### 7.3 校验

**`validateConfiguration`**：
- API key 与 baseUrl 非空
- URL 格式合法（`new URL(...)`）
- 协议限 https，或 localhost/127.0.0.1 的 http
- Model 名 ≤ 100 字符

**`validateAPIResponseStructure`**：
- `data.choices` 存在且非空
- 提取 `message.content`；GLM-4 兼容 `message.reasoning_content` fallback
- null / undefined / 非字符串 / 空串均抛错

### 7.4 建议流程

```
suggestChildNodes(context, template, systemMessage):
    校验 nodeText 非空，prompt ≤ 10k 字符，systemMessage ≤ 5k
    prompt = AIPrompts.buildUserPrompt(template, context)
    raw = await chat(prompt, systemMessage)
    suggestions = parseJSONResponse(raw)
    return deduplicateSuggestions(suggestions, context.existingChildren).slice(0, 5)

parseJSONResponse(raw):
    ① 优先正则 /\[[\s\S]*\]/ 提取 JSON 数组
    ② 否则按行拆分，去除 ```代码块围栏、# 标题、1. / -*• 前缀

deduplicateSuggestions(list, existing):
    lowercased = new Set(existing.map(toLower))
    return list.filter(item => !lowercased.has(item.toLower()))
```

**错误包装**：`AI suggestion failed for node "{text}": {msg}`。

---

## 8. `AIPrompts` — Prompt 变量替换

### 8.1 API

```typescript
class AIPrompts {
    static buildUserPrompt(template: string, context: NodeContext): string;
}

interface NodeContext {
    nodeText: string;
    level: number;
    parent?: string;
    siblings?: string[];
    existingChildren: string[];
    centralTopic?: string;
}
```

### 8.2 模板变量

| 占位 | 替换 |
|---|---|
| `{nodeText}` | context.nodeText |
| `{level}` | String(level) |
| `{parentContext}` | `"Parent node: {parent}\n"` 或 `""` |
| `{siblingsContext}` | `"Sibling nodes: a, b, c\n"` 或 `""` |
| `{existingChildren}` | `"Current children: ..."` 或 `"Current children: (none)"` |
| `{centralTopic}` | `"Central topic: {root}\n"` 或 `""` |

⚠️ 使用 `String.replace(str, str)`：**每个占位符仅替换首次出现**。若模板重复使用同一占位，需改为正则全局替换。

---

## 9. `Logger` — 单例日志

### 9.1 API

```typescript
class Logger {
    static getInstance(): Logger;

    setDebugEnabled(enabled): void;
    isDebugEnabled(): boolean;

    debug(tag, message, data?): void;                 // debug OFF 直接 return
    debugLazy(tag, message, dataFn: () => unknown);   // 惰性求值
    info(tag, message, data?): void;                  // debug 模式生效
    warn(tag, message, data?): void;                  // 始终 console；debug 才入 buffer
    error(tag, message, data?): void;

    clear(): void;
    getEntries(): LogEntry[];
    dumpToClipboard(): Promise<boolean>;              // 拷贝后清空
    flushToClipboard(): Promise<boolean>;             // 拷贝但保留（多次采样）

    snapshotViewport(tag, message, extra?): void;     // 捕获视口 & DOM 尺寸
}
```

### 9.2 关键字段

```
debugEnabled: boolean
buffer: LogEntry[]        // LRU: > 1000 条 shift()
```

### 9.3 快照采样

`snapshotViewport` 收集：
- `window.innerWidth/innerHeight`
- `window.visualViewport { width, height, offsetTop, offsetLeft, scale }`
- `document.activeElement { tagName, className, contentEditable }`
- `.mind-map-container` / SVG / `.node-unified-text.editing` 的 `getBoundingClientRect`

### 9.4 剪贴板写入

- 优先 `navigator.clipboard.writeText`（要求 `isSecureContext`）
- Fallback：临时 `<textarea>` + `document.execCommand('copy')`

**格式头**：
```
# openMindMap debug log
# Exported: ISO
# Entries: N
# Debug mode: ON/OFF

<ISO> [LEVEL] [TAG] message
  data: {json}
```

**`jsonReplacer`**：处理 Error（保留 name/message/stack）；剥离 `MindMapNode.parent` 为 `'[MindMapNode]'` 避免循环引用。

### 9.5 iPad Debug 导出入口

`NodeEditor.enableEditing` 中：
```
if depth === 0 && logger.isDebugEnabled():
    logger.flushToClipboard()   // 双击根节点即导出
```

替代命令 / ribbon，避免移动端命令面板难以操作。

---

## 10. `AccessibilityUtil` — 屏幕阅读器

### 10.1 API

```typescript
class AccessibilityUtil {
    static announce(message, priority: 'polite' | 'assertive' = 'polite'): void;
    static announceNodesAdded(count): void;
    static announceNodeDeleted(nodeText): void;
    static announceNodeEdited(oldText, newText): void;
    static announceError(errorMessage): void;
    static announceNodeToggled(nodeText, expanded): void;
    static destroy(): void;
}
```

### 10.2 实现

单例 `.mindmap-announcer` 元素：`role="status"`、`aria-live="polite"`、`aria-atomic="true"`。

**播报技巧**：
```
liveRegion.textContent = ''             // 清空
setTimeout(100, () => {
    liveRegion.textContent = message    // 写入 → SR 检测到变化
})
```

`assertive` 优先级用于错误（打断当前播报）。

---

## 11. `FontSizeManager` — 字号统一入口

```typescript
class FontSizeManager {
    static getFontSize(depth): string;                    // '20px'
    static getNumericFontSize(depth): number;             // 20
    static getTextMeasurementFontSize(): string;
    static getInteractionUIFontSize(): string;
    static isValidFontSize(fontSize): boolean;            // /^\d+px$/
    static fontSizeToNumber(fontSize): number;
    static getAllFontSizes(): Record<number, string>;
    static validateFontSizeConsistency(): boolean;        // root > level1 ≥ default
}
```

底层委托 `constants/mindmap-constants` 的 `getFontSizeByDepth` / `getNumericFontSizeByDepth`。

---

## 12. `I18nManager`

### 12.1 API

```typescript
class I18nManager {
    constructor(language: SupportedLanguage = 'en');

    getLanguage(): SupportedLanguage;
    setLanguage(language): void;                     // 重新 loadMessages
    getMessages(): MindMapMessages;
    format(key: string, params?: Record<string, string>): string;
}

createI18nManager(language?): I18nManager;
```

### 12.2 关键算法

**点分路径解析**：

```
getNestedValue(obj, 'notices.cannotDeleteRoot'):
    split('.').reduce((cur, key) => cur?.[key], obj)
```

**变量替换**：

```
replaceParams(template, params):
    template.replace(/\{(\w+)\}/g, (match, key) =>
        params?.[key] ?? match)     // 未提供则保留原样
```

### 12.3 `MindMapMessages` 顶层键

| 分组 | 用途 |
|---|---|
| `notices` | Notice 弹窗（20+ 条）|
| `errors` | 错误消息 |
| `validation` | 校验类文案 |
| `settings` | 设置面板 UI |
| `ui` | 界面元素（命令、菜单、AI 面板、编辑提示等）|
| `format(msg, params)` | 实例方法，占位符 `{param}` 替换 |

### 12.4 加载

`loadMessages(language)`：switch 加载 `en.ts` / `zh.ts` 字典模块。语言变更时**重新加载**整份 messages。

---

## 13. 使用约定

| 需求 | 首选 |
|---|---|
| 存储敏感数据 | `EncryptionUtil` |
| 计算画布/布局坐标 | `CoordinateConverter` |
| 测量节点尺寸 | `TextMeasurer.getNodeDimensions` |
| 解析/生成 Markdown | `mindmap-utils.parseMarkdownContent/generateMarkdownFromNodes` |
| 打日志 | `Logger.getInstance().debug/info/warn/error` |
| 屏幕阅读器 | `AccessibilityUtil.announce` |
| i18n 文案 | `messages.notices.foo` 或 `format('notices.foo', {name})` |
| 字号 | `FontSizeManager.getFontSize(depth)` |

## 14. 演进空间

- Encryption：将 `deviceInfo` 融合 install-id 提高不可复用性。
- TextMeasurer：接入 CSS 变量变化事件，主题切换时清缓存。
- Logger：可选上传到远端（用户显式开启）。
- I18n：支持外部 JSON 加载，无需重新打包即可添加语言。
- AIPrompts：改为全局正则替换以支持模板中重复出现的占位。

---

**文档结束**
