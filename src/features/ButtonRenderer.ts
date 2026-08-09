/**
 * Button Renderer - Button rendering functionality
 *
 * [Responsibilities]
 * - Render plus button (add child node)
 * - Render collapse toggle button
 * - Remove button
 * - Batch render buttons
 * - Handle button click events
 *
 * [Design Principles]
 * - Communicate with external via callbacks, no direct dependency on D3TreeRenderer
 * - Manage button rendering and removal
 * - Provide clear API for button operations
 *
 * [Refactoring Source]
 * Extracted from D3TreeRenderer.ts (Phase 3.4)
 * - renderPlusButtons() → renderButtons()
 * - renderPlusButton() → renderPlusButton()
 * - removePlusButton() → removePlusButton()
 * - handlePlusButtonClick() → (handled via callbacks)
 * - editNewNode() → (triggered via callbacks)
 */

import * as d3 from 'd3';
import { MindMapNode, NodeDimensions } from '../interfaces/mindmap-interfaces';
import { TextMeasurer } from '../utils/TextMeasurer';
import { MindMapService } from '../services/mindmap-service';

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

/**
 * 折叠按钮图标
 *
 * 用三角形而非 `+` / `−`，以免与"添加子节点"的 `+` 撞脸。
 *
 * @param expanded 节点当前是否展开
 * @returns 展开态 `▾`，折叠态 `▸`
 */
export function getCollapseIcon(expanded: boolean): string {
	return expanded ? '▾' : '▸';
}

/**
 * 是否渲染折叠按钮
 *
 * 只取决于深度：根节点不可折叠。无子节点的节点照常渲染——
 * 三格按钮栈的几何保持固定，切换选中节点时按钮不会跳变。
 *
 * @param depth 节点深度（根为 0）
 */
export function shouldRenderCollapseButton(depth: number): boolean {
	return depth !== 0;
}

/**
 * Button Renderer callback interface
 */
export interface ButtonRendererCallbacks {
	/**
	 * Called when adding child node (will trigger snapshot save)
	 */
	onAddChildNode?: (_node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * Called when the collapse button is clicked (will trigger snapshot save)
	 */
	onToggleCollapse?: (_node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * Called when button click requires entering edit mode
	 */
	enterEditMode?: (_node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * Called when button click requires clearing selection
	 */
	clearSelection?: () => void;

	/**
	 * Called when button click requires selecting node
	 */
	selectNode?: (_node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * Called when button click requires refreshing data
	 */
	onDataUpdated?: () => void;
}

/**
 * Button Renderer class
 *
 * Manages button rendering and interaction
 */
export class ButtonRenderer {
	// Dependencies
	private textMeasurer: TextMeasurer;
	private callbacks: ButtonRendererCallbacks;

	constructor(_mindMapService: MindMapService, textMeasurer: TextMeasurer, callbacks: ButtonRendererCallbacks) {
		this.textMeasurer = textMeasurer;
		this.callbacks = callbacks;
	}

	/**
	 * Batch render plus buttons (only for selected nodes)
	 *
	 * @param nodeElements D3 node selection set
	 */
	renderButtons(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		// Add plus button for each node
		const nodes = nodeElements.nodes();
		const data = nodeElements.data();

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const d = data[i];
			const nodeElement = d3.select(node);
			const dimensions = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);

			// Only render plus button for selected nodes
			if (d.data.selected) {
				this.renderPlusButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, d, dimensions);
			}
		}
	}

	/**
	 * Render plus button for a single node
	 *
	 * @param nodeElement Node element selection set
	 * @param node Node data
	 * @param dimensions Node dimensions
	 */
	renderPlusButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>,
		node: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): void {
		// Check if plus button already exists
		const existingButton = nodeElement.select(".plus-button-group");
		if (!existingButton.empty()) {
			return; // Don't create duplicate if already exists
		}

		// 使用共享的按钮栈几何，槽位 1（折叠按钮在槽位 0 上方）
		const buttonY = getButtonStackOffset(BUTTON_STACK_SLOT_PLUS, dimensions.height);
		const buttonX = getButtonStackX(dimensions.width);

		// Create plus button group
		const buttonGroup = nodeElement.append("g")
			.attr("class", "plus-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);

		// Add click event handler
		buttonGroup.on("click", (event: MouseEvent) => {
			this.handleButtonClick(event, node);
		});

		// Create circular background
		buttonGroup.append("circle")
			.attr("class", "plus-button-bg")
			.attr("cx", 10)
			.attr("cy", 10)
			.attr("r", 10)
			.attr("fill", "#2972f4")  // Blue background
			.style("opacity", 0.9)
			.style("cursor", "pointer");

		// Create plus text - fix center alignment
		buttonGroup.append("text")
			.attr("class", "plus-button-text")
			.attr("x", 10)              // Align with circle cx
			.attr("y", 10)              // Align with circle cy
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "white")
			.attr("font-size", "16px")
			.attr("font-weight", "bold")
			.style("pointer-events", "none")  // Block text events, let circular background receive events
			.text("+");
	}

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
		if (!shouldRenderCollapseButton(node.depth)) {
			return;
		}

		// Check if collapse button already exists
		const existingButton = nodeElement.select(".collapse-button-group");
		if (!existingButton.empty()) {
			return; // Don't create duplicate if already exists
		}

		// 使用共享的按钮栈几何，槽位 0（最上方）
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
			.text(getCollapseIcon(!!node.data.expanded));

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

	/**
	 * Remove plus button from node
	 *
	 * @param nodeElement Node element selection set
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
	 * Destroy
	 */
	destroy(): void {
		// Clean up resources (if needed)
	}

	// ========== Private Methods ==========

	/**
	 * Handle plus button click event
	 */
	private handleButtonClick(event: MouseEvent, node: d3.HierarchyNode<MindMapNode>): void {
		event.stopPropagation(); // Prevent event bubbling to node

		// Use callback to add child node (will trigger snapshot save)
		this.callbacks.onAddChildNode?.(node);
	}
}
