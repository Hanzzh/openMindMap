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

fs.unlinkSync(outfile);
fs.unlinkSync(serviceOutfile);
fs.unlinkSync(obsidianStub);
console.log(`\n${passed} 个断言通过\n`);
