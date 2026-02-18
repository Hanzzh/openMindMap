/**
 * Mind Map Layout Calculator
 *
 * 【职责】
 * 计算思维导图节点的位置和尺寸，实现自定义的树形布局算法
 *
 * 【布局算法原理】
 *
 * 本类使用两阶段递归算法计算节点位置：
 *
 * ┌─────────────────────────────────────────────┐
 * │           两阶段布局算法                      │
 * └─────────────────────────────────────────────┘
 *
 * 阶段1：自底向上（Bottom-Up）维度计算
 * ────────────────────────────────────
 * 目标：计算每个节点及其子树占据的空间
 *
 * 流程：
 *   1. 使用 D3.eachAfter() 进行后序遍历
 *   2. 先处理所有子节点，再处理父节点
 *   3. 对于叶子节点：
 *      - subtreeWidth = nodeWidth（自身宽度）
 *      - subtreeHeight = nodeHeight（自身高度）
 *   4. 对于分支节点：
 *      - subtreeWidth = max(自身宽度, 最宽子节点宽度)
 *      - subtreeHeight = sum(所有子节点subtreeHeight) + 间距
 *
 * 时间复杂度：O(N)，N为节点数量
 *
 *
 * 阶段2：自顶向下（Top-Down）位置分配
 * ────────────────────────────────────
 * 目标：为每个节点分配具体的 (x, y) 坐标
 *
 * 流程：
 *   1. 从根节点开始递归处理
 *   2. 对每个节点：
 *      a. 设置自身的 (x, y) 坐标
 *      b. 计算所有子节点的总高度
 *      c. 确定起始位置（使子节点组垂直居中）
 *      d. 为每个子节点分配位置
 *      e. 递归处理子节点
 *
 * 坐标分配：
 *   - 垂直位置（x）：根据子树高度计算，确保子节点垂直分布
 *   - 水平位置（y）：所有兄弟节点相同（左对齐）
 *
 *
 * 【坐标系统约定】⚠️ 重要
 *
 * 布局坐标系（由 LayoutCalculator 计算）：
 *   ┌─────────────────────────────────────┐
 *   │ d.x: 垂直位置（从上到下增加）         │
 *   │      - 表示节点的中心位置            │
 *   │      - 用于垂直居中计算              │
 *   │                                     │
 *   │ d.y: 水平位置（从左到右增加）         │
 *   │      - 表示节点的左边缘位置          │
 *   │      - 确保兄弟节点左对齐            │
 *   └─────────────────────────────────────┘
 *
 * 示例：
 *   父节点(d.x=100, d.y=200)
 *   ├─ 子节点1(d.x=50, d.y=350)  ← 与子节点2的y相同（左对齐）
 *   └─ 子节点2(d.x=150, d.y=350) ← 与子节点1的y相同（左对齐）
 *
 *
 * 【尺寸概念】
 *
 * nodeWidth (节点宽度)：
 *   - 节点自身的宽度
 *   - 包含：文本宽度 + padding×2 + 安全边距
 *
 * nodeHeight (节点高度)：
 *   - 节点自身的高度
 *   - 包含：文本高度 + padding×2
 *   - 多行文本：行数 × 行高 + padding×2
 *
 * subtreeWidth (子树宽度)：
 *   - 对于叶子节点：= nodeWidth
 *   - 对于分支节点：= max(自身宽度, 最宽子节点宽度)
 *   - 用途：确定父节点需要的最小宽度
 *
 * subtreeHeight (子树高度)：
 *   - 对于叶子节点：= nodeHeight
 *   - 对于分支节点：= sum(所有子节点subtreeHeight) + 间距
 *   - 用途：确定父节点需要的最小高度
 *   - 确保子节点之间不重叠
 *
 *
 * 【使用示例】
 *
 * ```typescript
 * const calculator = new LayoutCalculator();
 *
 * // 自定义布局
 * const root = calculator.createCustomTreeLayout(
 *     flatData,           // 扁平的节点数据
 *     nodeDimensionsFn     // 获取节点尺寸的回调函数
 * );
 *
 * // root.children 中的每个节点现在都有：
 * // - node.x, node.y: 布局坐标
 * // - node.data.subtreeWidth, node.data.subtreeHeight: 子树尺寸
 * ```
 *
 *
 * 【与其他组件的关系】
 *
 * LayoutCalculator (布局计算)
 *   ↓ 输出：带坐标的层级结构
 * D3TreeRenderer (D3渲染)
 *   ↓ 输出：SVG元素
 * 用户界面
 *
 *
 * 【性能考虑】
 *
 * - 时间复杂度：O(N)，每个节点访问两次
 * - 空间复杂度：O(N)，存储子树尺寸
 * - 适用规模：测试通过 1000+ 节点
 *
 *
 * @see D3TreeRenderer - 使用此布局进行渲染
 * @see NodeDimensions - 节点尺寸接口
 * @see LAYOUT_CONSTANTS - 布局常量配置
 */

import * as d3 from 'd3';
import { MindMapNode, NodeDimensions } from '../interfaces/mindmap-interfaces';
import { LAYOUT_CONSTANTS } from '../constants/mindmap-constants';

export interface LayoutConfig {
    minNodeGap: number;
    horizontalSpacing: number;
    verticalSpacing: number;
    minVerticalGap: number;
    treeHeight: number;
    treeWidth: number;
    nodeHeightBuffer: number;
}

/**
 * Layout calculator class
 *
 * 负责计算思维导图的树形布局
 */
export class LayoutCalculator {
    private config: LayoutConfig;

    constructor(config: Partial<LayoutConfig> = {}) {
        this.config = {
            minNodeGap: LAYOUT_CONSTANTS.MIN_NODE_GAP,
            horizontalSpacing: LAYOUT_CONSTANTS.HORIZONTAL_SPACING,
            verticalSpacing: LAYOUT_CONSTANTS.VERTICAL_SPACING,
            minVerticalGap: LAYOUT_CONSTANTS.MIN_VERTICAL_GAP,
            treeHeight: LAYOUT_CONSTANTS.TREE_HEIGHT,
            treeWidth: LAYOUT_CONSTANTS.TREE_WIDTH,
            nodeHeightBuffer: LAYOUT_CONSTANTS.NODE_HEIGHT_BUFFER,
            ...config
        };
    }

    /**
     * Create D3 tree layout
     */
    createTreeLayout(): d3.TreeLayout<MindMapNode> {
        return d3.tree<MindMapNode>()
            .nodeSize([this.config.minNodeGap, this.config.minNodeGap])
            .separation((a, b) => this.calculateDynamicSeparation(a, b));
    }

    /**
     * Calculate dynamic separation between nodes
     */
    private calculateDynamicSeparation(a: d3.HierarchyNode<MindMapNode>, b: d3.HierarchyNode<MindMapNode>): number {
        // For now, return default separation
        // In a full implementation, this would consider node dimensions
        return (a.parent === b.parent ? 1 : 2) / a.depth;
    }

    /**
     * 计算自适应水平间距
     * 基于源节点和目标节点的实际宽度动态计算间距
     * @param sourceWidth 源节点宽度
     * @param targetWidth 目标节点宽度
     * @returns 计算出的水平间距
     */
    calculateAdaptiveHorizontalSpacing(sourceWidth: number, targetWidth: number): number {
        const { ADAPTIVE_HORIZONTAL_SPACING } = LAYOUT_CONSTANTS;

        // 基于源节点宽度的间距
        const sourceBasedSpacing = sourceWidth * ADAPTIVE_HORIZONTAL_SPACING.SOURCE_NODE_RATIO;

        // 基于目标节点宽度的间距
        const targetBasedSpacing = targetWidth * ADAPTIVE_HORIZONTAL_SPACING.TARGET_NODE_RATIO;

        // 使用最大值确保足够空间，加上基础间距
        const calculatedSpacing = Math.max(sourceBasedSpacing, targetBasedSpacing) + ADAPTIVE_HORIZONTAL_SPACING.BASE_SPACING;

        // 限制在最小和最大间距之间
        const finalSpacing = Math.max(
            ADAPTIVE_HORIZONTAL_SPACING.MIN_SPACING,
            Math.min(ADAPTIVE_HORIZONTAL_SPACING.MAX_SPACING, calculatedSpacing)
        );

        return finalSpacing + ADAPTIVE_HORIZONTAL_SPACING.SAFETY_MARGIN;
    }

    /**
     * 获取节点尺寸（简化版本，实际应该从渲染器获取）
     * @param node 节点
     * @returns 节点尺寸估算
     */
    private estimateNodeDimensions(node: MindMapNode): NodeDimensions {
        // 基础字符宽度估算（根据字体大小）
        const fontSize = 14; // 默认字体大小
        const charWidth = fontSize * 0.6; // 字符宽度比例
        const padding = 15; // 节点内边距

        const width = Math.max(100, node.text.length * charWidth + padding * 2);
        const height = fontSize + padding * 2;

        return {
            width,
            height,
            fontSize: `${fontSize}px`,
            padding
        };
    }

    /**
     * 为父节点和所有子节点计算统一的水平间距
     * @param parentNode 父节点
     * @param childNodes 子节点数组
     * @returns 水平间距值
     */
    calculateHorizontalSpacingForFamily(parentNode: MindMapNode, childNodes: MindMapNode[]): number {
        const parentDimensions = this.estimateNodeDimensions(parentNode);

        // 如果没有子节点，返回默认间距
        if (!childNodes || childNodes.length === 0) {
            return this.calculateAdaptiveHorizontalSpacing(parentDimensions.width, 100);
        }

        // 计算所有子节点的最大宽度
        let maxChildWidth = 0;
        for (const childNode of childNodes) {
            const childDimensions = this.estimateNodeDimensions(childNode);
            maxChildWidth = Math.max(maxChildWidth, childDimensions.width);
        }

        // 使用最大子节点宽度计算间距
        return this.calculateAdaptiveHorizontalSpacing(parentDimensions.width, maxChildWidth);
    }

    /**
     * 创建自定义布局函数，使用递归自底向上算法
     * @param root D3层次结构根节点
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    createCustomTreeLayout(
        root: d3.HierarchyNode<MindMapNode>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 使用新的递归布局算法
        this.createRecursiveTreeLayout(root, nodeDimensionsCallback);
    }

    /**
     * 递归自底向上布局算法（核心方法）
     *
     * 【算法概述】
     *
     * 实现自定义的两阶段递归树形布局算法：
     *
     * ┌──────────────────────────────────────────┐
     * │  输入：扁平的节点数据（Markdown解析结果） │
     * │  输出：带坐标的 D3 层级结构               │
     * └──────────────────────────────────────────┘
     *
     *
     * 【详细流程】
     *
     * 步骤1：使用 D3.hierarchy() 创建层级结构
     *   - 输入：{ text: "root", children: [...] }
     *   - 输出：具有 parent, children, depth 等属性的对象
     *
     * 步骤2：阶段1 - 自底向上计算尺寸（calculateAllSubtreeDimensions）
     *   ┌────────────────────────────────────────┐
     *   │  from leaves to root                   │
     *   │  ┌─────┐                             │
     *   │  │ 叶子 │ subtreeHeight = nodeHeight   │
     *   │  └─────┘                             │
     *   │     ↓                                 │
     *   │  ┌─────┐                             │
     *   │  │ 父节点 │ subtreeHeight = sum(子节点) │
     *   │  └─────┘                             │
     *   └────────────────────────────────────────┘
     *   - 使用 D3.eachAfter() 进行后序遍历
     *   - 先计算所有子节点，再计算父节点
     *   - 每个节点存储 subtreeWidth 和 subtreeHeight
     *
     * 步骤3：阶段2 - 自顶向下分配位置（setNodePositionsTopDown）
     *   ┌────────────────────────────────────────┐
     *   │  from root to leaves                   │
     *   │  ┌─────┐                             │
     *   │  │根节点 │ x=100, y=100                │
     *   │  └─────┘                             │
     *   │     ↓ ↓                               │
     *   │  ┌─────┬─────┐                        │
     *   │  │子1  │子2  │  y坐标相同（左对齐）    │
     *   │  │x=50 │x=150│  x坐标不同（垂直分布）  │
     *   │  └─────┴─────┘                        │
     *   └────────────────────────────────────────┘
     *   - 从根节点开始递归
     *   - 为每个节点分配 (x, y) 坐标
     *   - 确保子节点组相对于父节点垂直居中
     *   - 兄弟节点左对齐（共享相同的 y 坐标）
     *
     *
     * 【坐标系统】⚠️ 重要
     *
     * 布局坐标系（由此方法计算）：
     *   - node.x: 垂直位置（中心点）
     *   - node.y: 水平位置（左边缘）
     *
     * 起始位置：
     *   - startX = 100: 根节点的垂直位置
     *   - startY = 100: 根节点的水平位置
     *
     *
     * 【时间复杂度】
     *
     * O(N)，其中 N 是节点数量：
     * - 阶段1: 每个节点访问一次（后序遍历）
     * - 阶段2: 每个节点访问一次（前序遍历）
     * - 总计: 2N 次访问 = O(N)
     *
     *
     * 【使用示例】
     *
     * ```typescript
     * const calculator = new LayoutCalculator();
     *
     * // 准备数据
     * const flatData = {
     *     text: "Root",
     *     children: [
     *         { text: "Child 1" },
     *         { text: "Child 2" }
     *     ]
     * };
     *
     * // 创建层级结构
     * const root = d3.hierarchy(flatData);
     *
     * // 计算布局
     * calculator.createRecursiveTreeLayout(root, nodeDimensionsFn);
     *
     * // 现在可以访问：
     * // root.x, root.y: 根节点坐标
     * // root.children[0].x, root.children[0].y: 子节点坐标
     * // root.data.subtreeWidth, root.data.subtreeHeight: 子树尺寸
     * ```
     *
     *
     * 【注意事项】
     *
     * ⚠️ 此方法会修改 root 对象，为其添加 x, y 坐标
     * ⚠️ nodeDimensionsCallback 必须返回准确的节点尺寸
     * ⚠️ 多行文本的节点高度会影响整体布局
     * ⚠️ 如果子节点总高度超过父节点高度，父节点会扩展
     *
     *
     * @param root D3层次结构根节点（由 d3.hierarchy() 创建）
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     *                              参数：(depth: number, text: string)
     *                              返回：{ width: number, height: number }
     * @returns void（直接修改 root 对象）
     *
     * @see calculateAllSubtreeDimensions() - 阶段1：尺寸计算
     * @see setNodePositionsTopDown() - 阶段2：位置分配
     * @see distributeChildrenVerticalSpace() - 子节点垂直分布
     */
    private createRecursiveTreeLayout(
        root: d3.HierarchyNode<MindMapNode>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 阶段1：自底向上计算所有节点的子树尺寸
        this.calculateAllSubtreeDimensions(root, nodeDimensionsCallback);

        // 阶段2：自顶向下设置节点位置
        // 根节点起始位置
        const startX = 100;         // 垂直位置（从顶部开始）
        const startY = 100;         // 水平位置（从左侧开始）

        this.setNodePositionsTopDown(root, startX, startY, nodeDimensionsCallback);
    }

    /**
     * 自底向上计算所有节点的子树尺寸（后序遍历）
     * 使用 D3 的 eachAfter 方法确保先处理子节点再处理父节点
     * @param root 根节点
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private calculateAllSubtreeDimensions(
        root: d3.HierarchyNode<MindMapNode>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        root.eachAfter(node => {
            const dims = nodeDimensionsCallback(node.depth, node.data.text);

            // 存储节点自身尺寸到数据中
            node.data.nodeWidth = dims.width;
            node.data.nodeHeight = dims.height;

            if (!node.children || node.children.length === 0) {
                // 叶子节点：子树尺寸 = 节点自身尺寸
                node.data.subtreeWidth = dims.width;
                node.data.subtreeHeight = dims.height;
            } else {
                // 分支节点：聚合子节点尺寸
                const childSubtrees = node.children.map(c => ({
                    width: c.data.subtreeWidth || 0,
                    height: c.data.subtreeHeight || 0
                }));

                // 子树宽度 = max(自身宽度, 最宽的子树)
                // 因为子节点是垂直排列的，所以宽度取最大值
                const maxChildWidth = Math.max(...childSubtrees.map(s => s.width));
                node.data.subtreeWidth = Math.max(dims.width, maxChildWidth);

                // 子树高度 = 所有子节点高度之和 + 间距
                const verticalGap = 10; // 子节点之间的垂直间距（与distributeChildrenVerticalSpace一致）
                let totalHeight = 0;
                node.children.forEach((child, index) => {
                    totalHeight += child.data.subtreeHeight || 0;
                    if (index < node.children.length - 1) {
                        totalHeight += verticalGap;
                    }
                });

                node.data.subtreeHeight = Math.max(dims.height, totalHeight);
            }
        });
    }

    /**
     * 自顶向下设置节点位置（前序遍历）
     * @param node 当前节点
     * @param x 节点X坐标（垂直位置）
     * @param y 节点Y坐标（水平位置）
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private setNodePositionsTopDown(
        node: d3.HierarchyNode<MindMapNode>,
        x: number,
        y: number,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 设置当前节点位置
        node.x = x;
        node.y = y;

        // 如果没有子节点，直接返回
        if (!node.children || node.children.length === 0) {
            return;
        }

        // 为子节点分配垂直空间
        this.distributeChildrenVerticalSpace(node, nodeDimensionsCallback);
    }

    /**
     * 为子节点分配垂直空间（垂直居中对齐）
     * @param parentNode 父节点
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private distributeChildrenVerticalSpace(
        parentNode: d3.HierarchyNode<MindMapNode>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        const children = parentNode.children;
        if (!children || children.length === 0) return;

        // 计算水平间距（基于深度）
        // 第0层（根到第一层）使用80px间距，其他层统一使用30px
        const horizontalSpacing = (parentNode.depth === 0) ? 80 : 30;

        // 计算所有子节点的总高度
        const verticalGap = 10; // 子节点之间的垂直间距（更紧凑）
        let totalChildrenHeight = 0;

        children.forEach((child, index) => {
            const childHeight = child.data.subtreeHeight || 0;
            totalChildrenHeight += childHeight;
            if (index < children.length - 1) {
                totalChildrenHeight += verticalGap;
            }
        });

        // 计算起始Y位置（使子节点组相对于父节点垂直居中）
        let currentY = parentNode.x - totalChildrenHeight / 2;

        // 为每个子节点设置位置
        children.forEach((child, index) => {
            // childX 是垂直位置，childY 是水平位置
            const childX = currentY + (child.data.subtreeHeight || 0) / 2;
            // childY（水平位置）= 父节点的右边缘 + 水平间距
            // 这样确保同一父节点的所有子节点左边缘对齐
            const childY = parentNode.y + (parentNode.data.nodeWidth || 0) + horizontalSpacing;

            // 递归设置子节点的位置
            this.setNodePositionsTopDown(child, childX, childY, nodeDimensionsCallback);

            // 更新当前Y位置（垂直方向）
            currentY += (child.data.subtreeHeight || 0) + verticalGap;
        });
    }

    /**
     * 计算自定义水平位置，确保同父节点子节点的左边缘完全对齐
     * @param root 根节点
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private calculateLeftAlignedHorizontalPositions(
        root: d3.HierarchyNode<MindMapNode>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 收集所有节点，按深度和父节点分组
        const nodeGroups = this.groupNodesByParent(root);

        // 设置根节点位置
        const rootDimensions = nodeDimensionsCallback(root.depth, root.data.text);
        root.y = 50; // 根节点固定左边距

        // 按层级处理每个父节点的子节点
        this.processNodeGroupsByLevel(nodeGroups, nodeDimensionsCallback);
    }

    /**
     * 按父节点分组所有节点
     * @param root 根节点
     * @returns 按父节点ID分组的节点映射
     */
    private groupNodesByParent(root: d3.HierarchyNode<MindMapNode>): Map<string, d3.HierarchyNode<MindMapNode>[]> {
        const groups = new Map<string, d3.HierarchyNode<MindMapNode>[]>();

        // 遍历所有节点，按父节点分组
        root.each(node => {
            if (node.depth > 0 && node.parent) {
                const parentId = node.parent.data.text; // 使用父节点文本作为唯一标识
                if (!groups.has(parentId)) {
                    groups.set(parentId, []);
                }
                const group = groups.get(parentId);
                if (group) {
                    group.push(node);
                }
            }
        });

        return groups;
    }

    /**
     * 按层级处理节点组，确保同父节点子节点左边缘对齐
     * @param nodeGroups 按父节点分组的节点
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private processNodeGroupsByLevel(
        nodeGroups: Map<string, d3.HierarchyNode<MindMapNode>[]>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 为每个父节点组统一设置子节点位置
        for (const [parentText, childNodes] of nodeGroups) {
            if (childNodes.length === 0) continue;

            // 获取第一个子节点来获取父节点引用
            const firstChild = childNodes[0];
            if (!firstChild.parent) {
                continue;
            }
            const parentNode = firstChild.parent;

            // 获取父节点尺寸和位置
            const parentDimensions = nodeDimensionsCallback(parentNode.depth, parentNode.data.text);
            const parentRightEdge = parentNode.y + parentDimensions.width;

            // 计算所有子节点的最大宽度（用于间距计算）
            let maxChildWidth = 0;
            for (const child of childNodes) {
                const childDimensions = nodeDimensionsCallback(child.depth, child.data.text);
                maxChildWidth = Math.max(maxChildWidth, childDimensions.width);
            }

            // 计算自适应间距
            const adaptiveSpacing = this.calculateAdaptiveHorizontalSpacing(
                parentDimensions.width,
                maxChildWidth
            );

            // 计算统一的左边缘位置（所有子节点的左边缘对齐）
            const unifiedLeftEdge = parentRightEdge + adaptiveSpacing;

            // 为所有子节点设置相同的左边缘位置
            for (const child of childNodes) {
                child.y = unifiedLeftEdge; // ✅ 左边缘对齐
            }
        }

        // 递归处理下一层级的节点组
        this.processNextLevelGroups(nodeGroups, nodeDimensionsCallback);
    }

    /**
     * 处理下一层级的节点组
     * @param nodeGroups 当前层级的节点组
     * @param nodeDimensionsCallback 获取节点尺寸的回调函数
     */
    private processNextLevelGroups(
        nodeGroups: Map<string, d3.HierarchyNode<MindMapNode>[]>,
        nodeDimensionsCallback: (depth: number, text: string) => NodeDimensions
    ): void {
        // 收集所有下一层级的子节点
        const nextLevelGroups = new Map<string, d3.HierarchyNode<MindMapNode>[]>();

        for (const childNodes of nodeGroups.values()) {
            for (const child of childNodes) {
                if (child.children && child.children.length > 0) {
                    const childText = child.data.text;
                    if (!nextLevelGroups.has(childText)) {
                        nextLevelGroups.set(childText, []);
                    }
                    const group = nextLevelGroups.get(childText);
                    if (group) {
                        group.push(...child.children);
                    }
                }
            }
        }

        // 如果还有下一层级，继续处理
        if (nextLevelGroups.size > 0) {
            this.processNodeGroupsByLevel(nextLevelGroups, nodeDimensionsCallback);
        }
    }

    /**
     * Calculate tree dimensions
     */
    calculateTreeDimensions(root: d3.HierarchyNode<MindMapNode>): { width: number; height: number } {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        root.each(node => {
            if (node.x !== undefined) {
                minX = Math.min(minX, node.x);
                maxX = Math.max(maxX, node.x);
            }
            if (node.y !== undefined) {
                minY = Math.min(minY, node.y);
                maxY = Math.max(maxY, node.y);
            }
        });

        const width = maxX - minX || this.config.treeWidth;
        const height = maxY - minY || this.config.treeHeight;

        return { width, height };
    }

    /**
     * Apply offsets to center the tree
     */
    centerTree(root: d3.HierarchyNode<MindMapNode>, canvasWidth: number, canvasHeight: number): { offsetX: number; offsetY: number } {
        const { width, height } = this.calculateTreeDimensions(root);

        const offsetX = (canvasWidth - width) / 2;
        const offsetY = (canvasHeight - height) / 2;

        // Apply offsets to all nodes
        root.each(node => {
            if (node.x !== undefined) {
                node.x += offsetX;
            }
            if (node.y !== undefined) {
                node.y += offsetY;
            }
        });

        return { offsetX, offsetY };
    }

    /**
     * Get layout configuration
     */
    getConfig(): LayoutConfig {
        return { ...this.config };
    }

    /**
     * Update layout configuration
     */
    updateConfig(newConfig: Partial<LayoutConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
}