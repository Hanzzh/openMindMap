/**
 * Button Renderer - 按钮渲染功能
 *
 * 【职责】
 * - 渲染+号按钮（添加子节点）
 * - 移除按钮
 * - 批量渲染按钮
 * - 处理按钮点击事件
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理按钮的渲染和移除
 * - 提供清晰的 API 用于按钮操作
 *
 * 【重构来源】
 * 从 D3TreeRenderer.ts 提取（Phase 3.4）
 * - renderPlusButtons() → renderButtons()
 * - renderPlusButton() → renderPlusButton()
 * - removePlusButton() → removePlusButton()
 * - handlePlusButtonClick() → (通过回调处理)
 * - editNewNode() → (通过回调触发)
 */

import * as d3 from 'd3';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { TextMeasurer } from '../utils/TextMeasurer';

/**
 * 节点尺寸接口
 */
export interface NodeDimensions {
	width: number;
	height: number;
}

/**
 * Button Renderer 回调接口
 */
export interface ButtonRendererCallbacks {
	/**
	 * 添加子节点时调用（会触发快照保存）
	 */
	onAddChildNode?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * 按钮点击后需要进入编辑模式时调用
	 */
	enterEditMode?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * 按钮点击后需要清除选择时调用
	 */
	clearSelection?: () => void;

	/**
	 * 按钮点击后需要选中节点时调用
	 */
	selectNode?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * 按钮点击后需要刷新数据时调用
	 */
	onDataUpdated?: () => void;
}

/**
 * Button Renderer 类
 *
 * 管理按钮的渲染和交互
 */
export class ButtonRenderer {
	constructor(
		private mindMapService: MindMapService,
		private textMeasurer: TextMeasurer,
		private callbacks: ButtonRendererCallbacks = {}
	) {}

	/**
	 * 批量渲染+号按钮（只为选中的节点渲染）
	 *
	 * @param nodeElements D3 节点选择集
	 */
	renderButtons(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		const self = this;

		// 为每个节点添加+号按钮
		nodeElements.each(function(d) {
			const nodeElement = d3.select(this);
			const dimensions = self.textMeasurer.getNodeDimensions(d.depth, d.data.text);

			// 只为选中的节点渲染+号按钮
			if (d.data.selected) {
				self.renderPlusButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, d, dimensions);
			}
		});
	}

	/**
	 * 渲染单个节点的+号按钮
	 *
	 * @param nodeElement 节点元素选择集
	 * @param node 节点数据
	 * @param dimensions 节点尺寸
	 */
	renderPlusButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>,
		node: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): void {
		// 检查是否已经存在+号按钮
		const existingButton = nodeElement.select(".plus-button-group");
		if (!existingButton.empty()) {
			return; // 已存在则不重复创建
		}

		// 计算两个按钮的总高度（+号按钮20px + 间距10px + AI按钮20px = 50px）
		const totalButtonsHeight = 20 + 10 + 20;
		// +号按钮位于上方位置
		const buttonY = (dimensions.height - totalButtonsHeight) / 2;

		// 创建+号按钮组
		const buttonGroup = nodeElement.append("g")
			.attr("class", "plus-button-group")
			.attr("transform", `translate(${dimensions.width + 4}, ${buttonY})`);

		// 添加点击事件处理器
		buttonGroup.on("click", (event: MouseEvent) => {
			this.handleButtonClick(event, node);
		});

		// 创建圆形背景
		buttonGroup.append("circle")
			.attr("class", "plus-button-bg")
			.attr("cx", 10)
			.attr("cy", 10)
			.attr("r", 10)
			.attr("fill", "#2972f4")  // 蓝色背景
			.style("opacity", 0.9)
			.style("cursor", "pointer");

		// 创建+号文本 - 修复居中对齐
		buttonGroup.append("text")
			.attr("class", "plus-button-text")
			.attr("x", 10)              // 与圆形cx对齐
			.attr("y", 10)              // 与圆形cy对齐
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "white")
			.attr("font-size", "16px")
			.attr("font-weight", "bold")
			.style("pointer-events", "none")  // 阻止文本事件，让圆形背景接收事件
			.text("+");
	}

	/**
	 * 移除节点的+号按钮
	 *
	 * @param nodeElement 节点元素选择集
	 */
	removePlusButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>
	): void {
		const buttonGroup = nodeElement.select(".plus-button-group");
		if (!buttonGroup.empty()) {
			buttonGroup.remove();
		}
	}

	/**
	 * 销毁
	 */
	destroy(): void {
		// 清理资源（如果需要）
	}

	// ========== 私有方法 ==========

	/**
	 * 处理+号按钮点击事件
	 */
	private handleButtonClick(event: MouseEvent, node: d3.HierarchyNode<MindMapNode>): void {
		event.stopPropagation(); // 阻止事件冒泡到节点

		// 使用回调添加子节点（会触发快照保存）
		this.callbacks.onAddChildNode?.(node);
	}
}
