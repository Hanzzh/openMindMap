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

// mindmap-service.ts 依赖 obsidian 运行时（仅 Notice），用最小桩替代后打包
const obsidianStub = path.join(os.tmpdir(), `obsidian-stub-${Date.now()}.js`);
fs.writeFileSync(obsidianStub, 'exports.Notice = class Notice {};\n');
const serviceOutfile = path.join(os.tmpdir(), `mindmap-service-${Date.now()}.js`);
esbuild.buildSync({
	entryPoints: [path.join(__dirname, '../src/services/mindmap-service.ts')],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'es2018',
	outfile: serviceOutfile,
	alias: { obsidian: obsidianStub },
	logLevel: 'silent',
});
const { MindMapService } = require(serviceOutfile);

// ButtonRenderer 的按钮栈几何是纯函数，但同文件 import 了 d3 / obsidian，
// 沿用上面的 obsidian 桩打包后即可直接调用
const buttonOutfile = path.join(os.tmpdir(), `button-renderer-${Date.now()}.js`);
esbuild.buildSync({
	entryPoints: [path.join(__dirname, '../src/features/ButtonRenderer.ts')],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'es2018',
	outfile: buttonOutfile,
	alias: { obsidian: obsidianStub },
	logLevel: 'silent',
});
const buttons = require(buttonOutfile);

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

console.log('\nMindMapService.createChildNode: 折叠父节点自动展开');

// createChildNode / createSiblingNode 只操作传入的节点，构造服务只需最小依赖
function makeService() {
	return new MindMapService({}, {});
}

test('在折叠的父节点上添加子节点 → 父节点自动展开', () => {
	const service = makeService();
	const parent = makeNode('折叠的父节点', 1, false);
	service.createChildNode(parent, '新子节点');
	assert.strictEqual(parent.expanded, true);
});

test('在已展开的父节点上添加子节点 → 保持展开', () => {
	const service = makeService();
	const parent = makeNode('展开的父节点', 1, true);
	service.createChildNode(parent, '新子节点');
	assert.strictEqual(parent.expanded, true);
});

test('新子节点被追加到父节点的 children 末尾', () => {
	const service = makeService();
	const parent = makeNode('父节点', 1, false);
	const existing = link(parent, makeNode('已有子节点', 2));
	const child = service.createChildNode(parent, '新子节点');
	assert.deepStrictEqual(parent.children, [existing, child]);
	assert.strictEqual(child.parent, parent);
	assert.strictEqual(child.level, 2);
});

test('createSiblingNode 不修改任何节点的 expanded 字段', () => {
	const service = makeService();
	const root = makeNode('根节点', 0, true);
	const parent = link(root, makeNode('折叠的父节点', 1, false));
	const anchor = link(parent, makeNode('锚点节点', 2, false));

	const sibling = service.createSiblingNode(anchor, '新兄弟节点');

	assert.ok(sibling, 'createSiblingNode 应返回新节点');
	assert.strictEqual(root.expanded, true);
	assert.strictEqual(parent.expanded, false, 'createSiblingNode 不应展开父节点');
	assert.strictEqual(anchor.expanded, false, 'createSiblingNode 不应改动锚点节点');
	assert.deepStrictEqual(parent.children, [anchor, sibling]);
});

console.log('\ncreateSubtreeFromMarkdown: 不能把折叠标记当成节点正文');

test('粘贴含 [collapsed:true] 的 markdown → 标记不进入节点文本', () => {
	const service = makeService();
	const root = service.createSubtreeFromMarkdown('* 任务 [collapsed:true]', 0);
	assert.ok(root, '应返回子树根节点');
	assert.strictEqual(
		root.text,
		'任务',
		'标记必须被剥离，否则保存再重载后节点会"自己改名"'
	);
});

test('不含标记的 markdown 文本保持原样', () => {
	const service = makeService();
	const root = service.createSubtreeFromMarkdown('* 普通节点', 0);
	assert.strictEqual(root.text, '普通节点');
});

console.log('\n复制/粘贴往返：多行节点文本不破坏子树结构');

test('含续行的节点经 序列化→反序列化 后结构不变', () => {
	const service = makeService();
	const root = makeNode('基本知识', 2);
	const def = link(root, makeNode('正念的定义：...', 3));
	link(def, makeNode('有目的/有意识', 4));
	const leadership = link(root, makeNode(
		'正念领导力：...\n领导力不一定是真实的职务，也是一种能力的体现。',
		3
	));
	link(root, makeNode('正念练习', 3));

	const md = service.serializeSubtreeToMarkdown(root);
	const parsed = service.createSubtreeFromMarkdown(md, 1);

	assert.ok(parsed, '应返回子树根节点');
	assert.strictEqual(parsed.text, '基本知识', '根节点必须仍是"基本知识"，不能被续行顶替');
	assert.strictEqual(parsed.children.length, 3, '应保留三个子节点');
	assert.strictEqual(
		parsed.children[1].text,
		'正念领导力：...\n领导力不一定是真实的职务，也是一种能力的体现。',
		'多行节点文本必须完整还原，且首字"领"不能被剥掉'
	);
	assert.ok(
		!parsed.children[1].text.startsWith('导力'),
		'续行首字不能被当列表标记剥掉'
	);
});

test('多行根节点也能正确往返', () => {
	const service = makeService();
	const root = makeNode('第一行\n第二行', 2);
	link(root, makeNode('子节点', 3));

	const md = service.serializeSubtreeToMarkdown(root);
	const parsed = service.createSubtreeFromMarkdown(md, 1);

	assert.ok(parsed, '应返回子树根节点');
	assert.strictEqual(parsed.text, '第一行\n第二行', '多行根节点文本应完整还原');
	assert.strictEqual(parsed.children.length, 1, '根节点的子节点应保留');
	assert.strictEqual(parsed.children[0].text, '子节点');
});

console.log('\n按钮栈几何：固定三格');

test('栈高度为 80（三格直径 + 两段间距）', () => {
	assert.strictEqual(buttons.BUTTON_STACK_HEIGHT, 80);
	assert.strictEqual(
		buttons.BUTTON_DIAMETER * buttons.BUTTON_STACK_SLOTS +
			buttons.BUTTON_GAP * (buttons.BUTTON_STACK_SLOTS - 1),
		80
	);
});

test('槽位索引自上而下为 0/1/2', () => {
	assert.strictEqual(buttons.BUTTON_STACK_SLOT_COLLAPSE, 0);
	assert.strictEqual(buttons.BUTTON_STACK_SLOT_PLUS, 1);
	assert.strictEqual(buttons.BUTTON_STACK_SLOT_AI, 2);
});

test('三个槽位的 Y 偏移（节点高 40）为 -20 / 10 / 40', () => {
	assert.strictEqual(buttons.getButtonStackOffset(0, 40), -20);
	assert.strictEqual(buttons.getButtonStackOffset(1, 40), 10);
	assert.strictEqual(buttons.getButtonStackOffset(2, 40), 40);
});

test('三个槽位的 Y 偏移（节点高 80）为 0 / 30 / 60', () => {
	assert.strictEqual(buttons.getButtonStackOffset(0, 80), 0);
	assert.strictEqual(buttons.getButtonStackOffset(1, 80), 30);
	assert.strictEqual(buttons.getButtonStackOffset(2, 80), 60);
});

test('相邻槽位间距恒为 30（直径 20 + 间距 10），与节点高度无关', () => {
	for (const h of [0, 24, 40, 137, 500]) {
		assert.strictEqual(buttons.getButtonStackOffset(1, h) - buttons.getButtonStackOffset(0, h), 30);
		assert.strictEqual(buttons.getButtonStackOffset(2, h) - buttons.getButtonStackOffset(1, h), 30);
	}
});

test('栈整体垂直居中于节点：首尾槽位跨度中点为 nodeHeight/2', () => {
	for (const h of [24, 40, 137]) {
		const top = buttons.getButtonStackOffset(0, h);
		const bottom = buttons.getButtonStackOffset(2, h) + buttons.BUTTON_DIAMETER;
		assert.strictEqual(bottom - top, 80, `高度 ${h} 的栈跨度应为 80`);
		assert.strictEqual((top + bottom) / 2, h / 2, `高度 ${h} 的栈应垂直居中`);
	}
});

test('水平偏移为节点宽度 + 4', () => {
	assert.strictEqual(buttons.getButtonStackX(0), 4);
	assert.strictEqual(buttons.getButtonStackX(100), 104);
});

console.log('\n折叠按钮：图标与渲染条件');

test('展开态图标为 ▾，折叠态为 ▸', () => {
	assert.strictEqual(buttons.getCollapseIcon(true), '▾');
	assert.strictEqual(buttons.getCollapseIcon(false), '▸');
});

test('图标不使用 + / − 以免与"添加子节点"撞脸', () => {
	for (const expanded of [true, false]) {
		const icon = buttons.getCollapseIcon(expanded);
		assert.ok(!['+', '-', '−'].includes(icon), `图标不应为 ${icon}`);
	}
});

test('根节点（depth 0）不渲染折叠按钮', () => {
	assert.strictEqual(buttons.shouldRenderCollapseButton(0), false);
});

test('非根节点渲染折叠按钮', () => {
	assert.strictEqual(buttons.shouldRenderCollapseButton(1), true);
	assert.strictEqual(buttons.shouldRenderCollapseButton(5), true);
});

test('渲染条件只取决于深度，与是否有子节点无关（保证按钮栈不跳变）', () => {
	// shouldRenderCollapseButton 只接受 depth：无子节点的节点照常渲染，
	// 签名上就无法把 children 数量作为隐藏条件。
	assert.strictEqual(buttons.shouldRenderCollapseButton.length, 1);
	const leaf = makeNode('叶子', 1);
	assert.strictEqual(leaf.children.length, 0);
	assert.strictEqual(buttons.shouldRenderCollapseButton(leaf.level), true);
});

fs.unlinkSync(outfile);
fs.unlinkSync(serviceOutfile);
fs.unlinkSync(buttonOutfile);
fs.unlinkSync(obsidianStub);
console.log(`\n${passed} 个断言通过\n`);
