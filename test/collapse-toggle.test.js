/**
 * 折叠切换 / 徽标生命周期 测试
 *
 * 本项目无 Jest 依赖，使用 node 内置 assert 编写独立脚本。
 * 运行：node test/collapse-toggle.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const esbuild = require('esbuild');

// obsidian 运行时桩（Logger / MindMapService 仅用到 Notice）
const obsidianStub = path.join(os.tmpdir(), `obsidian-stub-${Date.now()}.js`);
fs.writeFileSync(obsidianStub, 'exports.Notice = class Notice {};\n');

function bundle(relPath, name) {
	const outfile = path.join(os.tmpdir(), `${name}-${Date.now()}.js`);
	esbuild.buildSync({
		entryPoints: [path.join(__dirname, relPath)],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'es2018',
		outfile,
		alias: { obsidian: obsidianStub },
		logLevel: 'silent',
	});
	return { module: require(outfile), outfile };
}

const coordinatorBundle = bundle('../src/renderers/renderer-coordinator.ts', 'renderer-coordinator');
const { RendererCoordinator } = coordinatorBundle.module;

const nodeRendererBundle = bundle('../src/renderers/core/NodeRenderer.ts', 'node-renderer');
const { shouldShowCollapseBadge } = nodeRendererBundle.module;

const undoBundle = bundle('../src/managers/UndoManager.ts', 'undo-manager');
const { UndoManager } = undoBundle.module;

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

function makeNode(text, level, extra = {}) {
	return {
		text,
		level,
		parent: null,
		children: [],
		expanded: true,
		selected: false,
		hovered: false,
		...extra,
	};
}
function link(parent, child) {
	child.parent = parent;
	parent.children.push(child);
	return child;
}

/**
 * 构造一棵 root -> parent -> child -> grandchild 的树，全部标记为选中/悬停，
 * 用于验证"只清后代、不清自身"。
 */
function buildSelectedTree() {
	const root = makeNode('root', 0, { selected: true, hovered: true });
	const parent = link(root, makeNode('parent', 1, { selected: true, hovered: true }));
	const child = link(parent, makeNode('child', 2, { selected: true, hovered: true }));
	const grandchild = link(child, makeNode('grandchild', 3, { selected: true, hovered: true }));
	const sibling = link(root, makeNode('sibling', 1, { selected: true, hovered: true }));
	return { root, parent, child, grandchild, sibling };
}

/** 造一个只带最小状态的 coordinator 实例，绕过构造函数（无需 DOM） */
function makeCoordinator(overrides = {}) {
	const instance = Object.create(RendererCoordinator.prototype);
	instance.selectedNode = null;
	instance.hoveredNode = null;
	instance.currentData = null;
	instance.undoManager = { saveSnapshot: () => { instance._snapshots = (instance._snapshots || 0) + 1; } };
	instance._dataUpdates = 0;
	instance.triggerDataUpdate = () => { instance._dataUpdates++; };
	instance.syncCollapseBadges = () => { instance._badgeSyncs = (instance._badgeSyncs || 0) + 1; };
	Object.assign(instance, overrides);
	return instance;
}

console.log('\nclearDescendantSelectionStates: 只清后代，不动自身');

test('清除直接子节点的 selected/hovered', () => {
	const { parent, child } = buildSelectedTree();
	const c = makeCoordinator();
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(child.selected, false);
	assert.strictEqual(child.hovered, false);
});

test('递归清除孙节点的 selected/hovered', () => {
	const { parent, grandchild } = buildSelectedTree();
	const c = makeCoordinator();
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(grandchild.selected, false);
	assert.strictEqual(grandchild.hovered, false);
});

test('不清除被调用节点自身的状态（按钮栈须保留，故不能用 clearSelection）', () => {
	const { parent } = buildSelectedTree();
	const c = makeCoordinator();
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(parent.selected, true, '自身 selected 必须保留');
	assert.strictEqual(parent.hovered, true, '自身 hovered 必须保留');
});

test('不影响树中的旁系节点（兄弟与祖先）', () => {
	const { root, parent, sibling } = buildSelectedTree();
	const c = makeCoordinator();
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(sibling.selected, true, '兄弟节点不受影响');
	assert.strictEqual(root.selected, true, '祖先节点不受影响');
});

test('被清除的后代若正是当前 selectedNode/hoveredNode，引用同步置空避免悬空', () => {
	const { parent, child, grandchild } = buildSelectedTree();
	const c = makeCoordinator({
		selectedNode: { data: child },
		hoveredNode: { data: grandchild },
	});
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(c.selectedNode, null);
	assert.strictEqual(c.hoveredNode, null);
});

test('被折叠节点自身的 selectedNode 引用保持不变', () => {
	const { parent } = buildSelectedTree();
	const selectedRef = { data: parent };
	const c = makeCoordinator({ selectedNode: selectedRef });
	c.clearDescendantSelectionStates(parent);
	assert.strictEqual(c.selectedNode, selectedRef, '被折叠节点自身仍为选中节点');
});

test('叶子节点调用时不抛错', () => {
	const leaf = makeNode('leaf', 1);
	const c = makeCoordinator();
	assert.doesNotThrow(() => c.clearDescendantSelectionStates(leaf));
});

console.log('\nhandleToggleCollapse: 切换语义与根节点守卫');

test('根节点（depth 0）不可折叠：状态不变、不存快照、不触发更新', () => {
	const { root } = buildSelectedTree();
	root.expanded = true;
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 0, data: root });
	assert.strictEqual(root.expanded, true, '根节点仍应为展开态');
	assert.strictEqual(c._snapshots, undefined, '不应保存撤销快照');
	assert.strictEqual(c._dataUpdates, 0, '不应触发重渲染/保存');
});

test('非根展开节点：折叠后 expanded=false，并触发一次数据更新', () => {
	const { root, parent } = buildSelectedTree();
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: parent });
	assert.strictEqual(parent.expanded, false);
	assert.strictEqual(c._dataUpdates, 1);
});

test('折叠前保存撤销快照', () => {
	const { root, parent } = buildSelectedTree();
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: parent });
	assert.strictEqual(c._snapshots, 1);
});

test('折叠时清除后代选中态，保留自身选中态', () => {
	const { root, parent, child, grandchild } = buildSelectedTree();
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: parent });
	assert.strictEqual(child.selected, false);
	assert.strictEqual(grandchild.selected, false);
	assert.strictEqual(parent.selected, true, '被折叠节点自身仍选中，按钮栈才能连续操作');
});

test('展开（expanded=false → true）时不清除后代选中态', () => {
	const { root, parent, child } = buildSelectedTree();
	parent.expanded = false;
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: parent });
	assert.strictEqual(parent.expanded, true);
	assert.strictEqual(child.selected, true, '展开操作不应触碰后代状态');
});

test('连续切换两次回到原状态（幂等往返）', () => {
	const { root, parent } = buildSelectedTree();
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: parent });
	c.handleToggleCollapse({ depth: 1, data: parent });
	assert.strictEqual(parent.expanded, true);
	assert.strictEqual(c._dataUpdates, 2);
});

test('无子节点的节点也可切换（按钮栈几何固定，不特殊处理）', () => {
	const root = makeNode('root', 0);
	const leaf = link(root, makeNode('leaf', 1));
	const c = makeCoordinator({ currentData: { rootNode: root } });
	c.handleToggleCollapse({ depth: 1, data: leaf });
	assert.strictEqual(leaf.expanded, false);
});

console.log('\nshouldShowCollapseBadge: 徽标显示条件（创建与重加共用）');

test('已折叠 + 有子节点 + 未选中 → 显示', () => {
	const node = makeNode('n', 1, { expanded: false });
	link(node, makeNode('c', 2));
	assert.strictEqual(shouldShowCollapseBadge(node), true);
});

test('选中时不显示——按钮栈占据同一位置，徽标须让位', () => {
	const node = makeNode('n', 1, { expanded: false, selected: true });
	link(node, makeNode('c', 2));
	assert.strictEqual(shouldShowCollapseBadge(node), false);
});

test('展开态不显示', () => {
	const node = makeNode('n', 1, { expanded: true });
	link(node, makeNode('c', 2));
	assert.strictEqual(shouldShowCollapseBadge(node), false);
});

test('无子节点不显示', () => {
	const node = makeNode('n', 1, { expanded: false });
	assert.strictEqual(shouldShowCollapseBadge(node), false);
});

test('取消选中后恢复显示（徽标重加的前置条件）', () => {
	const node = makeNode('n', 1, { expanded: false, selected: true });
	link(node, makeNode('c', 2));
	assert.strictEqual(shouldShowCollapseBadge(node), false);
	node.selected = false;
	assert.strictEqual(shouldShowCollapseBadge(node), true, '取消选中后应重新满足显示条件');
});

console.log('\nUndoManager: expanded 由既有深拷贝自动捕获（无需修改 UndoManager）');

test('撤销可恢复被折叠节点的 expanded=true', () => {
	const root = makeNode('root', 0);
	const parent = link(root, makeNode('parent', 1));
	link(parent, makeNode('child', 2));

	const undoManager = new UndoManager();
	const data = { rootNode: root, allNodes: [root, parent, parent.children[0]], maxLevel: 2 };

	undoManager.saveSnapshot(data);
	parent.expanded = false;  // 模拟折叠

	const restored = undoManager.undo(data);
	assert.ok(restored, '应返回上一份快照');
	assert.strictEqual(restored.rootNode.children[0].expanded, true, '快照应保留折叠前的 expanded');
});

test('重做可恢复折叠态 expanded=false', () => {
	const root = makeNode('root', 0);
	const parent = link(root, makeNode('parent', 1));
	link(parent, makeNode('child', 2));

	const undoManager = new UndoManager();
	const data = { rootNode: root, allNodes: [root, parent, parent.children[0]], maxLevel: 2 };

	undoManager.saveSnapshot(data);
	parent.expanded = false;

	const undone = undoManager.undo(data);
	// 模拟 coordinator：把撤销结果写回当前数据
	const current = { rootNode: undone.rootNode, allNodes: undone.allNodes, maxLevel: undone.maxLevel };
	const redone = undoManager.redo(current);
	assert.ok(redone, '应返回重做快照');
	assert.strictEqual(redone.rootNode.children[0].expanded, false, '重做应恢复折叠态');
});

fs.unlinkSync(coordinatorBundle.outfile);
fs.unlinkSync(nodeRendererBundle.outfile);
fs.unlinkSync(undoBundle.outfile);
fs.unlinkSync(obsidianStub);
console.log(`\n${passed} 个断言通过\n`);
