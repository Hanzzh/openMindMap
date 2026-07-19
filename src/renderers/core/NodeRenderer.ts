import * as d3 from 'd3';
import { MindMapNode, NodeDimensions } from '../../interfaces/mindmap-interfaces';
import { TextMeasurer } from '../../utils/TextMeasurer';
import { LayoutCalculator } from '../layout-calculator';
import { CoordinateConverter } from '../../utils/coordinate-system';

/**
 * 节点渲染器
 *
 * 【职责】
 * - 创建SVG节点组
 * - 渲染节点矩形（background, border, colors）
 * - 处理节点尺寸和位置
 * - 应用节点样式（depth-based styling）
 *
 * 【依赖】
 * - TextMeasurer: 文本尺寸测量
 * - LayoutCalculator: 布局计算
 * - CoordinateConverter: 坐标转换
 */
export class NodeRenderer {
	constructor(
		private textMeasurer: TextMeasurer,
		private layoutCalculator: LayoutCalculator
	) {}

	/**
	 * 渲染所有节点
	 *
	 * @param svg SVG容器
	 * @param nodes D3层次节点数组
	 * @param offsetX X轴偏移量
	 * @param offsetY Y轴偏移量
	 * @returns 节点元素的D3选择
	 */
	renderNodes(
		svg: d3.Selection<SVGGElement, unknown, null, undefined>,
		nodes: d3.HierarchyNode<MindMapNode>[],
		offsetX: number,
		offsetY: number
	): d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown> {
		const nodeGroup = svg.append("g").attr("class", "nodes");

		const nodeElements = nodeGroup.selectAll("g")
			.data(nodes)
			.enter()
			.append("g")
			.attr("transform", (d) => {
				// 获取节点尺寸
				const dims = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);

				// 使用坐标转换工具计算transform
				const transform = CoordinateConverter.createTransform(
					d.x,              // 布局X（中心）
					d.y,              // 布局Y（左边缘）
					dims.width,       // 节点宽度
					dims.height,      // 节点高度
					offsetX,          // X偏移
					offsetY           // Y偏移
				);

				return transform;
			})
			// Accessibility: Add ARIA attributes to nodes
			.attr("role", "button")
			.attr("aria-label", (d) => `Mind map node: ${d.data.text}`)
			.attr("tabindex", "0")
			.attr("aria-level", (d) => d.depth + 1);

		// 节点矩形
		const nodeRects = nodeElements.append("rect")
			.attr("class", "node-rect")
			.attr("width", (d) => {
				const dims = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);
				return dims.width;
			})
			.attr("height", (d) => {
				const dims = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);
				return dims.height;
			})
			.attr("x", 0)
			.attr("y", 0)
			.attr("rx", 6)
			.attr("ry", 6)
			.attr("fill", (d) => {
				if (d.depth === 0) return "#2972f4";  // 根节点：蓝色
				return "#f3f5f7";  // 其他节点：浅灰色
			})
			.attr("stroke", (d) => {
				if (d.depth === 0) return "#2972f4";  // 根节点边框：保持原色
				return "none";  // 其他节点：无边框
			})
			.attr("stroke-width", (d) => d.depth === 0 ? 2 : 0)  // 只有根节点有边框
			.style("cursor", "pointer");  // 添加手型光标

		// 自动应用选中状态（高亮边框）
		nodeRects.classed("selected-rect", (d) => d.data.selected || false);

		return nodeElements;
	}

	/**
	 * 创建单个节点组（可选方法，用于动态添加节点）
	 *
	 * @param nodeData 节点数据
	 * @param dimensions 节点尺寸
	 * @param offsetX X轴偏移量
	 * @param offsetY Y轴偏移量
	 * @returns 节点组元素
	 */
	createNodeGroup(
		nodeData: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions,
		offsetX: number,
		offsetY: number
	): d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown> {
		// 此方法可用于动态添加单个节点
		// 当前实现中使用 renderNodes 批量创建
		throw new Error("Method not implemented. Use renderNodes() instead.");
	}

	/**
	 * 创建节点矩形背景（可选方法，用于样式自定义）
	 *
	 * @param nodeElement 节点组元素
	 * @param nodeData 节点数据
	 * @param dimensions 节点尺寸
	 * @returns 矩形元素
	 */
	createNodeRect(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>,
		nodeData: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGElement, unknown> {
		// 此方法可用于自定义矩形样式
		// 当前实现中矩形已在 renderNodes() 中创建
		throw new Error("Method not implemented. Rects are created in renderNodes().");
	}

	/**
	 * 获取节点padding值
	 *
	 * @param depth 节点深度
	 * @returns padding值（像素）
	 */
	getNodePadding(depth: number): number {
		if (depth === 0) return 24;    // 根节点padding
		else if (depth === 1) return 20; // 第1层padding
		else return 16;                 // 第2层及以后padding
	}
}
