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
// 断言失败也要清掉临时入口，否则会在 test/ 里留下未被忽略的 .ts 残留
process.on('exit', () => {
	try { fs.unlinkSync(entry); } catch { /* 已删除 */ }
});
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

// 以上关系式断言之外，再钉住具体数值：节点固定为 100x40、兄弟间距 10，
// 故 3 个子节点的子树高为 40*3 + 10*2 = 140，折叠后塌缩为 40。
assert.strictEqual(expandedParent.data.subtreeHeight, 140, '展开态 subtreeHeight 应为 40*3 + 10*2');
assert.strictEqual(collapsedParent.data.subtreeHeight, 40, '折叠态 subtreeHeight 应塌缩为单节点高 40');

// 兄弟节点应上移（占据被释放的垂直空间）
const expandedSibling = expandedRoot.children[1];
const collapsedSibling = collapsedRoot.children[1];
console.log('展开时 sibling.x =', expandedSibling.x, ' 折叠时 sibling.x =', collapsedSibling.x);
assert.ok(
	collapsedSibling.x < expandedSibling.x,
	'折叠后兄弟节点应上移填补垂直空缺'
);
// 具体数值：展开时 sibling 居于 140+10 之后，折叠时上移 50px
assert.strictEqual(expandedSibling.x, 175, '展开态 sibling.x 应为 175');
assert.strictEqual(collapsedSibling.x, 125, '折叠态 sibling.x 应上移至 125');

fs.unlinkSync(outfile);
console.log('\n✅ 折叠布局行为验证通过\n');
