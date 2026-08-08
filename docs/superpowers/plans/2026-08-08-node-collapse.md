# 节点折叠功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为思维导图节点添加折叠功能——点击折叠按钮隐藏整个子树，布局重算使折叠节点的子树高度等于其自身高度，折叠状态持久化到 markdown。

**Architecture:** 核心手段是在 `d3.hierarchy()` 构造时按 `expanded` 过滤 children，使折叠节点在 D3 层级中成为叶子节点，从而让既有 `LayoutCalculator`、`LinkRenderer`、`NodeRenderer` 自动折叠感知，无需改动布局算法。状态变更走既有 `triggerDataUpdate()` 通路复用重渲染与文件保存。持久化复用 `cleanTextContent()` 已有的 `[key:value]` 剥离约定，以行尾 `[collapsed:true]` 标记落盘。

**Tech Stack:** TypeScript 5.9.3、D3.js 7.9.0、Obsidian API 1.11.0、esbuild

**Spec:** `docs/superpowers/specs/2026-08-08-node-collapse-design.md`

## Global Constraints

- **不新增 `MindMapNode` 字段**：复用既有 `expanded: boolean`（`src/interfaces/mindmap-interfaces.ts:32`）。
- **样式只写根目录 `styles.css`**：`src/styles/*.css` 未被 git 跟踪、未被 esbuild 打包、无任何 import，Obsidian 不加载。写入那里没有任何效果。
- **`npx tsc -noEmit -skipLibCheck` 必须保持 exit 0**（当前基线干净）。
- **`npm run lint` 不是通过门槛**：干净检出已有 137 个既有错误。要求仅为不新增错误（`npm run lint 2>&1 | grep -c error` 基线为 139，改动后不应增加）。
- **本项目无可运行的自动化测试框架**：`npm test` / `npm run test:unit` 均指向不存在的文件，`test/unit/*.test.ts` 用 Jest 语法但无 Jest 依赖。本计划为纯函数逻辑编写**独立的 node 脚本断言测试**（不引入 Jest），UI 与集成行为通过 Obsidian 内手工验证清单确认。
- **折叠按钮栈固定三格**，几何恒定，与节点是否有子节点无关（避免切换选中时按钮跳变）。
- **根节点不可折叠**（`depth === 0`），`expanded` 恒为 `true`。
- 缩进约定：本项目 `src/` 下 TypeScript 使用 **Tab** 缩进（`renderer-coordinator.ts`、`ButtonRenderer.ts` 等），但 `src/utils/mindmap-utils.ts` 与 `src/renderers/layout-calculator.ts` 使用 **4 空格**。编辑时保持各文件原有风格。

---

## File Structure

| 文件 | 职责 | 改动类型 |
|---|---|---|
| `src/utils/mindmap-utils.ts` | `[collapsed:true]` 标记的读写（纯函数，可独立测试） | Modify |
| `src/services/mindmap-service.ts` | `createChildNode` 自动展开父节点 | Modify |
| `src/features/ButtonRenderer.ts` | 按钮栈偏移共享函数 + 折叠按钮渲染 | Modify |
| `src/features/AIAssistant.ts` | AI 按钮改用共享栈偏移 | Modify |
| `src/renderers/core/NodeRenderer.ts` | 折叠态子节点数徽标 | Modify |
| `src/interactions/interaction-manager.ts` | `RenderCallbacks` 增 `onToggleCollapse` | Modify |
| `src/interactions/MouseInteraction.ts` | 两处按 class 移除按钮补上折叠按钮组 | Modify |
| `src/renderers/renderer-coordinator.ts` | hierarchy 过滤、`handleToggleCollapse()`、按钮渲染与移除接线 | Modify |
| `styles.css` | 折叠按钮与徽标样式 | Modify |
| `test/collapse-markdown.test.js` | 标记读写的断言测试脚本 | Create |
| `test/verify-collapse-layout.js` | 折叠布局行为的断言脚本 | Create |

**任务顺序理由**：Task 1（持久化纯函数）无依赖且可独立测试，先做以建立信心。Task 2（自动展开）同样独立。Task 3-4（按钮几何）必须在 Task 5（折叠按钮）之前，否则三格偏移无处可用。Task 6（布局核心）单独成任务因其是本特性的关键行为，需独立验证。Task 7 收尾接线与样式。

---

## Task 1: Markdown 折叠标记的读写

**Files:**
- Modify: `src/utils/mindmap-utils.ts:125-137`（`parseListItem`）、`:143-175`（`generateMarkdownFromNodes`）、`:210-259`（`parseMarkdownContent` 循环体）
- Test: `test/collapse-markdown.test.js`（新建）

**Interfaces:**
- Consumes: 无（本任务是叶子依赖）
- Produces:
  - `parseListItem(line: string): { level: number; content: string; indent: string; collapsed: boolean } | null` —— 返回值新增 `collapsed` 字段
  - `generateMarkdownFromNodes(rootNode: MindMapNode): string` —— 签名不变，行为增加标记写入

**Context:** `cleanTextContent()`（`mindmap-utils.ts:18-24`）已有正则 `\[([a-zA-Z_][a-zA-Z0-9_]*:[^\]]+)\]` 会剥离 `[key:value]` 格式，因此 `[collapsed:true]` 会被自动从显示文本移除，**不要修改该函数**。`parseListItem` 必须在调用 `cleanTextContent` **之前**探测标记。

- [ ] **Step 1: 写失败测试**

创建 `test/collapse-markdown.test.js`。本项目无测试框架，故用 node 内置 `assert` 写独立脚本。**脚本必须放在项目内**（如 `test/`），放在 `/tmp` 会导致 `require('esbuild')` 解析失败（已实测确认）：

```javascript
/**
 * 折叠标记读写测试
 *
 * 本项目无 Jest 依赖，使用 node 内置 assert 编写独立脚本。
 * 运行：node test/collapse-markdown.test.js
 */

const assert = require('assert');
const path = require('path');

// 用 esbuild 把 TS 源码转成可 require 的 CJS 临时文件
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');

const outfile = path.join(os.tmpdir(), `mindmap-utils-${Date.now()}.js`);
esbuild.buildSync({
	entryPoints: [path.join(__dirname, '../src/utils/mindmap-utils.ts')],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'es2018',
	outfile,
	logLevel: 'silent',
});
const utils = require(outfile);

let passed = 0;
function test(name, fn) {
	try {
		fn();
		console.log(`  ✅ ${name}`);
		passed++;
	} catch (err) {
		console.log(`  ❌ ${name}`);
		console.log(`     ${err.message}`);
		process.exitCode = 1;
	}
}

console.log('\nparseListItem: 折叠标记探测');

test('无标记时 collapsed 为 false', () => {
	const r = utils.parseListItem('* 普通节点');
	assert.strictEqual(r.collapsed, false);
	assert.strictEqual(r.content, '普通节点');
});

test('有标记时 collapsed 为 true 且标记不出现在 content 中', () => {
	const r = utils.parseListItem('* 折叠节点 [collapsed:true]');
	assert.strictEqual(r.collapsed, true);
	assert.strictEqual(r.content, '折叠节点');
});

test('collapsed:false 视为展开，且标记被剥离', () => {
	const r = utils.parseListItem('* 节点 [collapsed:false]');
	assert.strictEqual(r.collapsed, false);
	assert.strictEqual(r.content, '节点');
});

test('缩进层级仍正确解析', () => {
	const r = utils.parseListItem('        * 深层节点 [collapsed:true]');
	assert.strictEqual(r.level, 2);
	assert.strictEqual(r.collapsed, true);
	assert.strictEqual(r.content, '深层节点');
});

console.log('\ngenerateMarkdownFromNodes: 折叠标记写入');

// 构造测试树的辅助函数
function makeNode(text, level, expanded = true) {
	return { text, level, parent: null, children: [], expanded };
}
function link(parent, child) {
	child.parent = parent;
	parent.children.push(child);
	return child;
}

test('折叠且有子节点 → 写入标记', () => {
	const root = makeNode('文件名', 0);
	const a = link(root, makeNode('父节点', 1, false));
	link(a, makeNode('子节点', 2));
	const md = utils.generateMarkdownFromNodes(root);
	assert.ok(md.includes('* 父节点 [collapsed:true]'), md);
});

test('展开且有子节点 → 不写标记', () => {
	const root = makeNode('文件名', 0);
	const a = link(root, makeNode('父节点', 1, true));
	link(a, makeNode('子节点', 2));
	const md = utils.generateMarkdownFromNodes(root);
	assert.ok(!md.includes('[collapsed'), md);
});

test('折叠但无子节点 → 不写标记', () => {
	const root = makeNode('文件名', 0);
	link(root, makeNode('叶子', 1, false));
	const md = utils.generateMarkdownFromNodes(root);
	assert.ok(!md.includes('[collapsed'), md);
});

test('多行文本：标记只落在首行', () => {
	const root = makeNode('文件名', 0);
	const a = link(root, makeNode('第一行\n第二行', 1, false));
	link(a, makeNode('子节点', 2));
	const md = utils.generateMarkdownFromNodes(root);
	assert.ok(md.includes('* 第一行 [collapsed:true]'), md);
	assert.ok(!md.includes('第二行 [collapsed:true]'), md);
});

console.log('\n往返测试');

test('折叠状态经 生成→解析 后保持', () => {
	const root = makeNode('测试文件', 0);
	const a = link(root, makeNode('折叠的', 1, false));
	link(a, makeNode('隐藏子节点', 2));
	const b = link(root, makeNode('展开的', 1, true));
	link(b, makeNode('可见子节点', 2));

	const md = utils.generateMarkdownFromNodes(root);
	const parsed = utils.parseMarkdownContent(md, ' 测试文件.md');

	const collapsed = parsed.allNodes.find(n => n.text === '折叠的');
	const expanded = parsed.allNodes.find(n => n.text === '展开的');
	assert.ok(collapsed, '未找到"折叠的"节点，说明标记污染了文本');
	assert.strictEqual(collapsed.expanded, false);
	assert.strictEqual(expanded.expanded, true);
});

fs.unlinkSync(outfile);
console.log(`\n${passed} 个断言通过\n`);
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
node test/collapse-markdown.test.js
```

Expected: FAIL —— `parseListItem` 返回值无 `collapsed` 字段，断言报 `undefined !== false`；`generateMarkdownFromNodes` 不写标记，断言报找不到 `[collapsed:true]`。

- [ ] **Step 3: 实现 `parseListItem` 标记探测**

`src/utils/mindmap-utils.ts` —— 替换 `:122-137` 整个函数（注意此文件用 **4 空格**缩进）：

```typescript
/**
 * Parse a single markdown list item
 * Detects the trailing [collapsed:true] marker before text cleaning
 */
export function parseListItem(line: string): { level: number; content: string; indent: string; collapsed: boolean } | null {
    const match = line.match(/^(\s*)([*\-+]?\d*\.?)\s+(.+)$/);
    if (!match) return null;

    const [, indent, , rawContent] = match;
    const level = Math.floor(indent.length / 4); // 4 spaces = 1 level

    // 在 cleanTextContent 剥离属性之前探测折叠标记
    // 只认字面 true；[collapsed:false] 等其他值视为展开
    const collapsed = /\[collapsed:true\]\s*$/.test(rawContent);

    return {
        level,
        content: cleanTextContent(rawContent),
        indent,
        collapsed
    };
}
```

- [ ] **Step 4: 实现 `parseMarkdownContent` 应用折叠状态**

同文件，`:218` 处解构增加 `collapsed`，`:221-227` 处 `newNode` 的 `expanded` 改为取反：

```typescript
            const { level, content, indent, collapsed } = parsed;

            // 3. 创建新节点
            const newNode: MindMapNode = {
                text: content,
                level: level + 1, // +1 因为根节点是 level 0
                parent: null,
                children: [],
                expanded: !collapsed
            };
```

- [ ] **Step 5: 实现 `generateMarkdownFromNodes` 标记写入**

同文件，替换 `:147-167` 的 `generateNodeMarkdown` 内部函数体：

```typescript
    // 递归生成子节点的markdown
    const generateNodeMarkdown = (node: MindMapNode, indentLevel: number): void => {
        if (node.level === 0) return; // 跳过根节点（文件名）

        const indent = "    ".repeat(indentLevel - 1); // level 1 缩进 0，level 2 缩进 4空格，以此类推
        const listPrefix = "*"; // 使用 * 作为列表符号

        // 折叠标记：仅当已折叠且确实有子节点时写入，保持文件干净
        const collapsedMarker = (!node.expanded && node.children.length > 0)
            ? " [collapsed:true]"
            : "";

        // 分割多行文本，标记只追加到首行
        const lines = node.text.split('\n');
        markdown += `${indent}${listPrefix} ${lines[0]}${collapsedMarker}\n`;

        // 输出续行，续行缩进 = 列表缩进 + 2空格（对应`* `）
        const continuationIndent = indent + "  ";
        for (let i = 1; i < lines.length; i++) {
            markdown += `${continuationIndent}${lines[i]}\n`;
        }

        // 递归处理子节点
        for (const child of node.children) {
            generateNodeMarkdown(child, indentLevel + 1);
        }
    };
```

- [ ] **Step 6: 运行测试，确认通过**

```bash
node test/collapse-markdown.test.js
```

Expected: PASS，输出 `9 个断言通过`。

- [ ] **Step 7: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 8: 提交**

```bash
git add src/utils/mindmap-utils.ts test/collapse-markdown.test.js
git commit -m "feat: persist node collapse state as markdown marker

Read and write a trailing [collapsed:true] marker on list items.
parseListItem detects it before cleanTextContent strips the
[key:value] form, so the marker never reaches display text. The
marker is only written for nodes that are both collapsed and have
children, keeping files clean.

Adds a standalone assert-based test script since the project has no
runnable test framework."
```

---

## Task 2: 折叠节点上添加子节点时自动展开

**Files:**
- Modify: `src/services/mindmap-service.ts:151-164`（`createChildNode`）

**Interfaces:**
- Consumes: 无
- Produces: `createChildNode(parentNode: MindMapNode, childText?: string): MindMapNode` —— 签名不变，副作用增加 `parentNode.expanded = true`

**Context:** 此改动一处覆盖全部四个添加子节点入口：`renderer-coordinator.ts:659`（Tab 键与 `+` 按钮）、`AIAssistant.ts:352`（AI 建议）、`ClipboardManager.ts:222`（粘贴）。`createSiblingNode` 无需改动——新兄弟挂在 `afterNode.parent` 下，而该父节点必然已展开（否则 `afterNode` 不可见、无法被选中）。

- [ ] **Step 1: 修改 `createChildNode` 自动展开父节点**

`src/services/mindmap-service.ts` —— 替换 `:148-164`（此文件用 **4 空格**缩进）：

```typescript
    /**
     * Create a new child node for the given parent node
     *
     * Auto-expands the parent so the new child is visible. This single
     * point covers all callers: Tab key / plus button, AI suggestions,
     * and paste.
     */
    createChildNode(parentNode: MindMapNode, childText = "New Node"): MindMapNode {
        const childNode: MindMapNode = {
            text: childText,
            level: parentNode.level + 1,
            parent: parentNode,
            children: [],
            expanded: true,
            selected: false,
            hovered: false
        };

        parentNode.children.push(childNode);

        // 自动展开父节点，否则新子节点不可见且无法进入编辑模式
        parentNode.expanded = true;

        return childNode;
    }
```

- [ ] **Step 2: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 3: 确认 Task 1 的测试仍通过（回归检查）**

```bash
node test/collapse-markdown.test.js
```

Expected: PASS，`9 个断言通过`。

- [ ] **Step 4: 提交**

```bash
git add src/services/mindmap-service.ts
git commit -m "feat: auto-expand parent when adding a child node

Setting expanded in createChildNode covers all four add-child entry
points at once: Tab key, plus button, AI suggestions, and paste.
Without this, a new child added to a collapsed node would be invisible
and could not enter edit mode."
```

---

## Task 3: 抽取共享的三格按钮栈偏移

**Files:**
- Modify: `src/features/ButtonRenderer.ts:106-154`（`renderPlusButton`）、新增导出常量与函数

**Interfaces:**
- Consumes: 无
- Produces:
  - `BUTTON_STACK_SLOT_COLLAPSE = 0`、`BUTTON_STACK_SLOT_PLUS = 1`、`BUTTON_STACK_SLOT_AI = 2` —— 导出常量
  - `getButtonStackOffset(slotIndex: number, nodeHeight: number): number` —— 导出函数，返回该槽位的垂直偏移

**Context:** 当前 `ButtonRenderer.ts:118` 与 `AIAssistant.ts:84` 各自硬编码 `const totalButtonsHeight = 20 + 10 + 20`（两格）。改为固定三格后必须共享同一计算，否则两处常量会漂移。三格：直径 20 的圆 ×3 + 10px 间距 ×2 = 80。

- [ ] **Step 1: 新增共享偏移常量与函数**

`src/features/ButtonRenderer.ts` —— 在 `import` 之后、`ButtonRendererCallbacks` 接口之前插入（此文件用 **Tab** 缩进）：

```typescript
/**
 * 按钮栈几何常量
 *
 * 节点选中时右侧竖排三个按钮：折叠 / 添加子节点 / AI 建议。
 * 栈高度固定为三格，与节点是否有子节点无关——这样切换选中不同
 * 节点时按钮位置不会跳变。
 */
export const BUTTON_DIAMETER = 20;
export const BUTTON_GAP = 10;
export const BUTTON_STACK_SLOTS = 3;
export const BUTTON_STACK_HEIGHT =
	BUTTON_DIAMETER * BUTTON_STACK_SLOTS + BUTTON_GAP * (BUTTON_STACK_SLOTS - 1); // 80

/** 槽位索引：自上而下 */
export const BUTTON_STACK_SLOT_COLLAPSE = 0;
export const BUTTON_STACK_SLOT_PLUS = 1;
export const BUTTON_STACK_SLOT_AI = 2;

/**
 * 计算按钮栈中指定槽位的垂直偏移
 *
 * @param slotIndex 槽位索引（0=折叠, 1=加号, 2=AI）
 * @param nodeHeight 节点自身高度
 * @returns 该槽位相对节点顶边的 Y 偏移
 */
export function getButtonStackOffset(slotIndex: number, nodeHeight: number): number {
	const stackTop = (nodeHeight - BUTTON_STACK_HEIGHT) / 2;
	return stackTop + slotIndex * (BUTTON_DIAMETER + BUTTON_GAP);
}

/** 按钮栈的水平偏移（相对节点左边缘） */
export function getButtonStackX(nodeWidth: number): number {
	return nodeWidth + 4;
}
```

- [ ] **Step 2: `renderPlusButton` 改用共享偏移**

同文件，替换 `renderPlusButton` 中 `:117-125` 的几何计算部分（保留其余不变）：

```typescript
		// 使用共享的按钮栈几何，槽位 1（折叠按钮在槽位 0 上方）
		const buttonY = getButtonStackOffset(BUTTON_STACK_SLOT_PLUS, dimensions.height);
		const buttonX = getButtonStackX(dimensions.width);

		// Create plus button group
		const buttonGroup = nodeElement.append("g")
			.attr("class", "plus-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);
```

- [ ] **Step 3: `AIAssistant` 改用共享偏移**

`src/features/AIAssistant.ts` —— 在文件顶部 import 区加入（与既有 import 同风格）：

```typescript
import {
	getButtonStackOffset,
	getButtonStackX,
	BUTTON_STACK_SLOT_AI
} from './ButtonRenderer';
```

然后替换 `:83-92` 的几何计算部分：

```typescript
		// 使用共享的按钮栈几何，槽位 2（最下方）
		const buttonY = getButtonStackOffset(BUTTON_STACK_SLOT_AI, dimensions.height);
		const buttonX = getButtonStackX(dimensions.width);

		// Create AI suggestion button group
		const buttonGroup = nodeElement.append("g")
			.attr("class", "ai-suggest-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);
```

- [ ] **Step 4: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 5: 确认循环依赖未引入**

`AIAssistant` 现在 import `ButtonRenderer`。确认 `ButtonRenderer` 未反向 import `AIAssistant`：

```bash
grep -n "AIAssistant" src/features/ButtonRenderer.ts
```

Expected: 无输出（无反向依赖，故无循环）。

- [ ] **Step 6: 构建产物验证**

```bash
node esbuild.config.mjs production && ls -la main.js
```

Expected: 构建成功，`main.js` 存在。

- [ ] **Step 7: 提交**

```bash
git add src/features/ButtonRenderer.ts src/features/AIAssistant.ts
git commit -m "refactor: share button stack geometry across renderers

ButtonRenderer and AIAssistant each hard-coded the same two-slot stack
height. Extract shared slot constants and offset helpers, and widen the
stack to a fixed three slots so the upcoming collapse button has a
place and buttons never shift between nodes."
```

---

## Task 4: 折叠按钮渲染

**Files:**
- Modify: `src/features/ButtonRenderer.ts`（新增 `renderCollapseButton` 与 `removeCollapseButton` 方法、回调接口增字段）

**Interfaces:**
- Consumes: `getButtonStackOffset`、`getButtonStackX`、`BUTTON_STACK_SLOT_COLLAPSE`（Task 3）
- Produces:
  - `ButtonRendererCallbacks.onToggleCollapse?: (node: d3.HierarchyNode<MindMapNode>) => void`
  - `ButtonRenderer.renderCollapseButton(nodeElement, node, dimensions): void`
  - CSS class 名：`.collapse-button-group`、`.collapse-button-bg`、`.collapse-button-text`

**Context:** 图标用 `▾`（展开态）/ `▸`（折叠态），不用 `+`/`−` 以免与"添加子节点"的 `+` 撞脸。根节点（`node.depth === 0`）不渲染此按钮。无子节点的节点**照常渲染且可点击**（保证按钮栈不跳变），点击切换 `expanded` 但无可见效果，且因 Task 1 的写入条件不成立而不产生 markdown 标记。

- [ ] **Step 1: 回调接口增加 `onToggleCollapse`**

`src/features/ButtonRenderer.ts` —— 在 `ButtonRendererCallbacks` 接口内追加（紧随 `onAddChildNode` 之后）：

```typescript
	/**
	 * Called when the collapse button is clicked (will trigger snapshot save)
	 */
	onToggleCollapse?: (_node: d3.HierarchyNode<MindMapNode>) => void;
```

- [ ] **Step 2: 新增 `renderCollapseButton` 方法**

同文件，在 `renderPlusButton` 方法之后插入：

```typescript
	/**
	 * Render collapse toggle button for a single node
	 *
	 * Occupies the top slot of the button stack. Rendered for every node
	 * except the root, including nodes without children — the stack keeps a
	 * fixed three-slot geometry so buttons never shift when the selection
	 * moves between nodes.
	 *
	 * @param nodeElement Node element selection set
	 * @param node Node data
	 * @param dimensions Node dimensions
	 */
	renderCollapseButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>,
		node: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): void {
		// 根节点不可折叠
		if (node.depth === 0) {
			return;
		}

		// Check if collapse button already exists
		const existingButton = nodeElement.select(".collapse-button-group");
		if (!existingButton.empty()) {
			return; // Don't create duplicate if already exists
		}

		const buttonY = getButtonStackOffset(BUTTON_STACK_SLOT_COLLAPSE, dimensions.height);
		const buttonX = getButtonStackX(dimensions.width);

		const buttonGroup = nodeElement.append("g")
			.attr("class", "collapse-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);

		// Add click event handler
		buttonGroup.on("click", (event: MouseEvent) => {
			event.stopPropagation(); // Prevent event bubbling to node
			this.callbacks.onToggleCollapse?.(node);
		});

		// Create circular background
		buttonGroup.append("circle")
			.attr("class", "collapse-button-bg")
			.attr("cx", 10)
			.attr("cy", 10)
			.attr("r", 10)
			.attr("fill", "#64748b")  // Slate background, distinct from plus/AI
			.style("opacity", 0.9)
			.style("cursor", "pointer");

		// Create triangle icon: down when expanded, right when collapsed
		buttonGroup.append("text")
			.attr("class", "collapse-button-text")
			.attr("x", 10)
			.attr("y", 10)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "white")
			.attr("font-size", "12px")
			.style("pointer-events", "none")  // Let the circle receive events
			.text(node.data.expanded ? "▾" : "▸");

		// Add title tooltip
		buttonGroup.append("title")
			.text(node.data.expanded ? "Collapse" : "Expand");
	}

	/**
	 * Remove collapse button from node
	 *
	 * @param nodeElement Node element selection set
	 */
	removeCollapseButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>
	): void {
		const buttonGroup = nodeElement.select(".collapse-button-group");
		if (!buttonGroup.empty()) {
			buttonGroup.remove();
		}
	}
```

- [ ] **Step 3: 添加折叠按钮样式**

`styles.css` —— 在 "Plus Button Styles" 段落之后（即 `:133` 之后、`Link Styles` 注释之前）插入。**注意：不要写入 `src/styles/`，那些文件 Obsidian 不加载**：

```css
/* ------------------------------------------------------------------------
   Collapse Button Styles
   ------------------------------------------------------------------------ */

.collapse-button-group {
    cursor: pointer;
    transition: all 0.2s ease;
}

.collapse-button-group:hover .collapse-button-bg {
    opacity: 1 !important;
    transform: scale(1.1);
}

.collapse-button-bg {
    transition: all 0.2s ease;
}

.collapse-button-text {
    pointer-events: none;
    transition: all 0.2s ease;
}

/* Child-count badge shown on collapsed nodes */
.node-collapse-badge {
    pointer-events: none;
}

.node-collapse-badge-bg {
    fill: var(--text-muted);
    opacity: 0.85;
}

.node-collapse-badge-text {
    fill: var(--background-primary);
    font-size: 11px;
    font-weight: bold;
    pointer-events: none;
}
```

- [ ] **Step 4: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/features/ButtonRenderer.ts styles.css
git commit -m "feat: add collapse toggle button to the node button stack

Occupies the top slot, using a triangle icon that reflects state. Not
rendered for the root node, but rendered for childless nodes so the
three-slot stack geometry stays fixed and buttons never shift when the
selection moves.

Styles go in the root styles.css; src/styles/*.css is an unfinished
refactor that Obsidian never loads."
```

---

## Task 5: 折叠布局核心 + 子节点数徽标

**Files:**
- Modify: `src/renderers/renderer-coordinator.ts:298`（`d3.hierarchy` 调用）
- Modify: `src/renderers/core/NodeRenderer.ts:36-100`（`renderNodes`，追加徽标）

**Interfaces:**
- Consumes: 无
- Produces: 无新导出（行为改动）

**Context:** 这是本特性的关键改动。`d3.hierarchy` 的第二参数是 children 访问器；返回空数组即让该节点在层级中成为叶子。由此 `LayoutCalculator.calculateAllSubtreeDimensions`（`layout-calculator.ts:419`）走叶子分支令 `subtreeHeight = nodeHeight`，`distributeChildrenVerticalSpace`（`:485`）提前 return 不分配垂直空间，`root.links()` / `root.descendants()` 自动不返回被折叠后代。**不要修改 `layout-calculator.ts`。**

徽标仅在「已折叠 **且** 有子节点 **且** 未被选中」时显示——选中时按钮栈占据同一位置，故须让位。

- [ ] **Step 1: hierarchy 构造时按 expanded 过滤 children**

`src/renderers/renderer-coordinator.ts` —— 替换 `:297-298`（此文件用 **Tab** 缩进）：

```typescript
			// Calculate layout - create D3 hierarchy
			// Children accessor filters out collapsed subtrees, which makes
			// collapsed nodes leaves in the hierarchy. LayoutCalculator then
			// gives them subtreeHeight === nodeHeight automatically, and
			// root.links() / root.descendants() skip hidden descendants — so
			// no layout, link, or node rendering code needs to change.
			root = d3.hierarchy(data.rootNode, d => d.expanded ? d.children : []);
```

- [ ] **Step 2: 渲染折叠态子节点数徽标**

`src/renderers/core/NodeRenderer.ts` —— 在 `renderNodes` 方法内、`nodeRects.classed(...)` 之后、`return nodeElements;` 之前插入（此文件用 **Tab** 缩进）：

```typescript
		// 折叠态子节点数徽标
		// 仅当已折叠、确有子节点、且未被选中时显示——选中时按钮栈
		// 占据同一位置，徽标须让位。
		nodeElements.each((d, i, groups) => {
			const shouldShowBadge =
				!d.data.expanded &&
				d.data.children.length > 0 &&
				!d.data.selected;

			if (!shouldShowBadge) {
				return;
			}

			const dims = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);
			const badge = d3.select(groups[i]).append("g")
				.attr("class", "node-collapse-badge")
				.attr("transform", `translate(${dims.width + 4}, ${dims.height / 2 - 9})`);

			badge.append("circle")
				.attr("class", "node-collapse-badge-bg")
				.attr("cx", 9)
				.attr("cy", 9)
				.attr("r", 9);

			badge.append("text")
				.attr("class", "node-collapse-badge-text")
				.attr("x", 9)
				.attr("y", 9)
				.attr("text-anchor", "middle")
				.attr("dominant-baseline", "middle")
				.text(d.data.children.length);
		});
```

- [ ] **Step 3: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 4: 验证折叠后子树高度确实等于节点自身高度**

创建临时验证脚本 `test/verify-collapse-layout.js`，直接对 `LayoutCalculator` 断言（这是本特性的核心行为，值得机器验证而非仅靠肉眼）。

**注意**：脚本与 esbuild 入口文件都必须放在**项目内**——放在 `/tmp` 会导致 `require('esbuild')` 或 `import 'd3'` 无法解析模块（已实测确认）。

```javascript
/**
 * 验证：折叠节点的 subtreeHeight 等于其 nodeHeight
 *
 * 运行：node test/verify-collapse-layout.js
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const esbuild = require('esbuild');

// 入口文件必须放在项目内，否则 esbuild 无法解析 d3 依赖
const entry = path.join(__dirname, `_layout-entry-${Date.now()}.ts`);
fs.writeFileSync(entry, `
export { LayoutCalculator } from '../src/renderers/layout-calculator';
export * as d3 from 'd3';
`);

const outfile = path.join(os.tmpdir(), `layout-${Date.now()}.js`);
esbuild.buildSync({
	entryPoints: [entry],
	bundle: true, format: 'cjs', platform: 'node', target: 'es2018',
	outfile, logLevel: 'silent',
});
const { LayoutCalculator, d3 } = require(outfile);

function makeNode(text, level, expanded = true) {
	return { text, level, parent: null, children: [], expanded };
}
function link(parent, child) { child.parent = parent; parent.children.push(child); return child; }

// 构造：根 -> 父节点(含3个子节点) + 兄弟节点
function buildTree(parentExpanded) {
	const root = makeNode('root', 0);
	const p = link(root, makeNode('parent', 1, parentExpanded));
	link(p, makeNode('c1', 2));
	link(p, makeNode('c2', 2));
	link(p, makeNode('c3', 2));
	link(root, makeNode('sibling', 1));
	return root;
}

const dims = () => ({ width: 100, height: 40, fontSize: '14px', padding: 15 });
const calc = new LayoutCalculator();

// 展开态
const expandedRoot = d3.hierarchy(buildTree(true), d => d.expanded ? d.children : []);
calc.createCustomTreeLayout(expandedRoot, dims);
const expandedParent = expandedRoot.children[0];

// 折叠态
const collapsedRoot = d3.hierarchy(buildTree(false), d => d.expanded ? d.children : []);
calc.createCustomTreeLayout(collapsedRoot, dims);
const collapsedParent = collapsedRoot.children[0];

console.log('展开时 parent.subtreeHeight =', expandedParent.data.subtreeHeight);
console.log('折叠时 parent.subtreeHeight =', collapsedParent.data.subtreeHeight);
console.log('折叠时 parent.nodeHeight    =', collapsedParent.data.nodeHeight);

assert.strictEqual(
	collapsedParent.data.subtreeHeight,
	collapsedParent.data.nodeHeight,
	'折叠后子树高度应等于节点自身高度'
);
assert.ok(
	expandedParent.data.subtreeHeight > collapsedParent.data.subtreeHeight,
	'展开态子树高度应大于折叠态'
);
assert.strictEqual(collapsedRoot.descendants().length, 3, '折叠后应只有 root + parent + sibling 三个可见节点');
assert.strictEqual(expandedRoot.descendants().length, 6, '展开时应有 6 个可见节点');

// 兄弟节点应上移（占据被释放的垂直空间）
const expandedSibling = expandedRoot.children[1];
const collapsedSibling = collapsedRoot.children[1];
console.log('展开时 sibling.x =', expandedSibling.x, ' 折叠时 sibling.x =', collapsedSibling.x);
assert.ok(
	collapsedSibling.x < expandedSibling.x,
	'折叠后兄弟节点应上移填补垂直空缺'
);

fs.unlinkSync(entry); fs.unlinkSync(outfile);
console.log('\n✅ 折叠布局行为验证通过\n');
```

运行：

```bash
node test/verify-collapse-layout.js
```

Expected: PASS。已实测的预期输出：

```
展开时 parent.subtreeHeight = 140
折叠时 parent.subtreeHeight = 40
折叠时 parent.nodeHeight    = 40
展开时 sibling.x = 175  折叠时 sibling.x = 125

✅ 折叠布局行为验证通过
```

- [ ] **Step 5: 确认 Task 1 测试仍通过**

```bash
node test/collapse-markdown.test.js
```

Expected: PASS，`9 个断言通过`。

- [ ] **Step 6: 提交**

```bash
git add src/renderers/renderer-coordinator.ts src/renderers/core/NodeRenderer.ts test/verify-collapse-layout.js
git commit -m "feat: collapse subtrees in layout and show child-count badge

Filtering children in the d3.hierarchy accessor makes collapsed nodes
leaves, so LayoutCalculator gives them subtreeHeight === nodeHeight and
siblings move up to fill the gap. root.links() and root.descendants()
skip hidden descendants, so no layout or link code changes.

The badge shows the direct child count on collapsed nodes, hidden while
selected because the button stack occupies the same position.

Adds a script asserting the layout behaviour directly, since this is the
feature's core mechanism."
```

---

## Task 6: 折叠状态切换与撤销集成

**Files:**
- Modify: `src/interactions/interaction-manager.ts:40-55`（`RenderCallbacks` 接口）
- Modify: `src/renderers/renderer-coordinator.ts`（`initializeFeatureModules` 接线、新增 `handleToggleCollapse`、`handleNodeSelected`、`restoreSelectionUI`、`clearSelection`）
- Modify: `src/interactions/MouseInteraction.ts:213-214`、`:331-332`（按 class 移除按钮）

**Interfaces:**
- Consumes: `ButtonRenderer.renderCollapseButton`（Task 4）、`ButtonRendererCallbacks.onToggleCollapse`（Task 4）
- Produces: `RenderCallbacks.onToggleCollapse?: (node: d3.HierarchyNode<MindMapNode>) => void`

**Context:** 折叠流程复用既有 `triggerDataUpdate()` 通路，重渲染与文件保存免费获得。`UndoManager.deepCloneNode()`（`UndoManager.ts:134`）用 `{ ...node }` 浅拷贝字段后递归 children，`expanded` 自动被快照捕获，**无需修改 UndoManager**。

**关键陷阱**：折叠时**不能**调用 `clearSelection()`——那会清除被折叠节点自身的选中态，用户刚点的按钮栈随即消失，无法连续操作。只清除**后代**的 `selected`/`hovered`。

- [ ] **Step 1: `RenderCallbacks` 接口增加 `onToggleCollapse`**

`src/interactions/interaction-manager.ts` —— 在 `RenderCallbacks` 接口内 `onAddChildNode` 之后插入（此文件用 **Tab** 缩进）：

```typescript
	onToggleCollapse?: (node: d3.HierarchyNode<MindMapNode>) => void;
```

- [ ] **Step 2: 接线 ButtonRenderer 回调**

`src/renderers/renderer-coordinator.ts` —— 在 `initializeFeatureModules()` 的 `buttonCallbacks` 对象内（`:212-218`）追加一行：

```typescript
		const buttonCallbacks: ButtonRendererCallbacks = {
			onAddChildNode: (node) => this.handleAddChildNode(node),
			onToggleCollapse: (node) => this.handleToggleCollapse(node),
			enterEditMode: (node) => this.enterEditModeForNode(node),
			clearSelection: () => this.clearSelection(),
			selectNode: (node) => this.selectNode(node),
			onDataUpdated: () => this.triggerDataUpdate()
		};
```

- [ ] **Step 3: 实现 `handleToggleCollapse`**

同文件，在 `handleAddChildNode` 方法之前插入：

```typescript
	/**
	 * Toggle a node's collapsed state
	 *
	 * Reuses the existing triggerDataUpdate() path, which re-renders the
	 * layout and saves the file. The snapshot makes the toggle undoable;
	 * expanded is a plain boolean field so UndoManager's deep clone already
	 * captures it.
	 */
	private handleToggleCollapse(node: d3.HierarchyNode<MindMapNode>): void {
		// 根节点不可折叠
		if (node.depth === 0) {
			return;
		}

		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		const willCollapse = node.data.expanded;

		// 即将折叠时，清除后代的选中/悬停状态。
		// 注意：不能调用 clearSelection()——那会清除被折叠节点自身的
		// 选中态，用户刚点的按钮栈随即消失，无法连续操作。
		if (willCollapse) {
			this.clearDescendantSelectionStates(node.data);
		}

		node.data.expanded = !node.data.expanded;

		Logger.getInstance().debug('RendererCoordinator', 'handleToggleCollapse', {
			text: node.data.text,
			expanded: node.data.expanded,
			childCount: node.data.children.length
		});

		this.triggerDataUpdate();
	}

	/**
	 * Recursively clear selection/hover state on a node's descendants
	 *
	 * The node itself keeps its state — it stays selected so its button
	 * stack remains usable right after collapsing.
	 */
	private clearDescendantSelectionStates(node: MindMapNode): void {
		for (const child of node.children) {
			// 若被清除的正是当前选中节点，同步置空引用避免悬空
			if (this.selectedNode && this.selectedNode.data === child) {
				this.selectedNode = null;
			}
			if (this.hoveredNode && this.hoveredNode.data === child) {
				this.hoveredNode = null;
			}

			child.selected = false;
			child.hovered = false;

			this.clearDescendantSelectionStates(child);
		}
	}
```

- [ ] **Step 4: 选中时渲染折叠按钮**

同文件，在 `handleNodeSelected`（`:598`）内、`renderPlusButton` 调用**之前**插入一行：

```typescript
		this.buttonRenderer.renderCollapseButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, node, dimensions);
```

同样在 `restoreSelectionUI`（`:1049`）内、`renderPlusButton` 调用之前插入：

```typescript
					this.buttonRenderer.renderCollapseButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, d, dimensions);
```

- [ ] **Step 5: 取消选中时移除折叠按钮（三处）**

`src/renderers/renderer-coordinator.ts` 的 `clearSelection()`（`:828-829`）追加一行：

```typescript
		// Remove all buttons
		d3.selectAll('.plus-button-group').remove();
		d3.selectAll('.ai-suggest-button-group').remove();
		d3.selectAll('.collapse-button-group').remove();
```

`src/interactions/MouseInteraction.ts` 的 `clearSelection()`（`:213-214`）追加一行：

```typescript
			selectedNodeElement.select('.plus-button-group').remove();
			selectedNodeElement.select('.ai-suggest-button-group').remove();
			selectedNodeElement.select('.collapse-button-group').remove();
```

同文件 `performNodeSelection()`（`:331-332`）追加一行：

```typescript
			previousNodeElement.select('.plus-button-group').remove();
			previousNodeElement.select('.ai-suggest-button-group').remove();
			previousNodeElement.select('.collapse-button-group').remove();
```

- [ ] **Step 6: 确认三处移除点都已覆盖**

```bash
grep -rn "collapse-button-group" src/ | grep remove
```

Expected: 恰好 3 行输出——`renderer-coordinator.ts` 一处、`MouseInteraction.ts` 两处。漏掉任何一处都会导致折叠按钮残留在已取消选中的节点上。

- [ ] **Step 7: 确认类型检查通过**

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: 无输出，exit 0。

- [ ] **Step 8: 完整构建**

```bash
npm run build
```

Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 9: 确认未新增 lint 错误**

```bash
npm run lint 2>&1 | grep -c error
```

Expected: ≤ 139（基线值）。若超出，检查新增代码的 lint 问题并修复。

- [ ] **Step 10: 提交**

```bash
git add src/interactions/interaction-manager.ts src/interactions/MouseInteraction.ts src/renderers/renderer-coordinator.ts
git commit -m "feat: wire up collapse toggle with undo support

Toggling reuses triggerDataUpdate(), so re-layout and file save come for
free, and the snapshot makes it undoable without touching UndoManager
(expanded is a plain boolean the deep clone already copies).

Collapsing clears selection state on descendants only — calling
clearSelection() would drop the collapsed node's own selection and make
its button stack vanish mid-interaction. Button removal is added at all
three class-based removal sites."
```

---

## Task 7: 手工验收验证

**Files:** 无代码改动——本任务是验收关卡

**Interfaces:**
- Consumes: Task 1-6 的全部改动
- Produces: 验收结论

**Context:** 本项目无 UI 自动化测试能力，故 UI 与集成行为必须在 Obsidian 内手工确认。以 `test/test-data.md` 为样本（该文件已有 4 层嵌套结构，适合验证折叠）。

- [ ] **Step 1: 构建并在 Obsidian 中加载**

```bash
npm run build
```

将插件目录置于 vault 的 `.obsidian/plugins/` 下（或在已有安装上重载插件），打开 `test/test-data.md`。

- [ ] **Step 2: 逐项验证核心布局行为**

- [ ] 折叠"项目管理 → 需求分析"，确认其 3 个子节点消失，**下方"项目规划"上移填补垂直空缺**（核心需求）
- [ ] 折叠节点显示子节点数徽标 ③；再次选中该节点时徽标隐藏、按钮栈出现
- [ ] 展开后布局恢复原状

- [ ] **Step 3: 验证自动展开**

- [ ] 对折叠节点按 Tab → 自动展开且新子节点进入编辑态
- [ ] 对折叠节点点 `+` 按钮 → 同上
- [ ] 对折叠节点粘贴（Ctrl+V）→ 自动展开
- [ ] 对折叠节点用 AI 建议添加 → 自动展开（需已配置 API）

- [ ] **Step 4: 验证选中态与按钮栈**

- [ ] 折叠某节点后，**该节点自身仍选中、按钮栈仍可用**，可立即再点展开
- [ ] 折叠含选中子节点的子树 → 展开后无残留高亮
- [ ] 在有子节点与无子节点的节点间切换选中 → **按钮栈位置不跳变**
- [ ] 取消选中后，折叠按钮不残留

- [ ] **Step 5: 验证撤销与持久化**

- [ ] Ctrl+Z 撤销折叠、Ctrl+Y（或 Ctrl+Shift+Z）重做
- [ ] 折叠后检查 `test-data.md` 出现 `[collapsed:true]`
- [ ] 关闭并重开文件 → 折叠状态如实恢复
- [ ] 确认节点显示文本**不含** `[collapsed:true]` 残留

- [ ] **Step 6: 验证边界情形**

- [ ] 无子节点的节点点击折叠按钮 → 无视觉变化、不报错、文件**不出现**标记
- [ ] 根节点（文件名节点）**不显示**折叠按钮
- [ ] 多行文本节点折叠后，标记只落在首行（查看 markdown 源码确认）
- [ ] 移动端模式：设置中将 Device Type 改为 mobile，重复 Step 2 的折叠/展开验证

- [ ] **Step 7: 提交验收记录（如有修复）**

若验收中发现问题并修复，为每个修复单独提交。若全部通过，无需提交。

---

## Self-Review

**1. Spec coverage** —— 逐节核对 spec：

| Spec 章节 | 对应任务 |
|---|---|
| 2.1 复用既有字段 | Global Constraints + Task 1 Step 4 |
| 2.2 唯一布局改动点 | Task 5 Step 1 |
| 2.3 无需改动 LayoutCalculator | Task 5 Step 4（机器验证） |
| 2.4 数据完整性 | Task 5 Step 1 注释说明 |
| 3.1-3.2 按钮栈布局与几何 | Task 3 |
| 3.3 折叠按钮行为（图标/可见性/无子节点/根节点） | Task 4 Step 2 + Task 6 Step 4-5 |
| 3.4 子节点数徽标 | Task 5 Step 2 |
| 3.5 样式（根 styles.css） | Task 4 Step 3 |
| 4.1 折叠切换流程 | Task 6 Step 3 |
| 4.2 自动展开 | Task 2 |
| 4.3 Markdown 写入 | Task 1 Step 5 |
| 4.4 Markdown 读取与边界 | Task 1 Step 3-4 |
| 4.5 撤销与选中态一致性 | Task 6 Step 3（`clearDescendantSelectionStates`） |
| 5 受影响文件（9 项） | File Structure 表（9 项 + 1 测试文件） |
| 6.2 静态校验 | 各任务的 tsc 步骤 + Task 6 Step 9 |
| 6.3 Markdown 往返 | Task 1 往返测试 + Task 7 Step 5 |
| 6.4 验收清单（10 项） | Task 7 Step 2-6 |

无遗漏。

**2. Placeholder scan** —— 无 TBD/TODO；所有代码步骤均含完整可粘贴代码；所有命令含预期输出。

**3. Type consistency** —— 核对跨任务引用：
- `getButtonStackOffset(slotIndex, nodeHeight)` —— Task 3 定义，Task 3 Step 2/3、Task 4 Step 2 使用，签名一致
- `getButtonStackX(nodeWidth)` —— 同上，一致
- `BUTTON_STACK_SLOT_COLLAPSE/PLUS/AI` —— Task 3 定义，Task 3-4 使用，命名一致
- `onToggleCollapse` —— Task 4 Step 1 定义于 `ButtonRendererCallbacks`，Task 6 Step 1 定义于 `RenderCallbacks`，Task 6 Step 2 接线，命名一致
- `renderCollapseButton(nodeElement, node, dimensions)` —— Task 4 Step 2 定义，Task 6 Step 4 调用两次，参数顺序一致
- `clearDescendantSelectionStates(node: MindMapNode)` —— Task 6 Step 3 内定义并调用，一致
- CSS class `.collapse-button-group` / `-bg` / `-text`、`.node-collapse-badge` / `-bg` / `-text` —— Task 4 Step 2-3、Task 5 Step 2、Task 6 Step 5 使用，一致
- `parseListItem` 返回值新增 `collapsed` —— Task 1 Step 3 定义，Step 4 消费，一致
