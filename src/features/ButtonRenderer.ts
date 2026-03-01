/**
 * Button Renderer - Button rendering functionality
 *
 * [Responsibilities]
 * - Render plus button (add child node)
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
 * Button Renderer callback interface
 */
export interface ButtonRendererCallbacks {
	/**
	 * Called when adding child node (will trigger snapshot save)
	 */
	onAddChildNode?: (_node: d3.HierarchyNode<MindMapNode>) => void;

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

		// Calculate total height of both buttons (plus button 20px + spacing 10px + AI button 20px = 50px)
		const totalButtonsHeight = 20 + 10 + 20;
		// Plus button positioned at the top
		const buttonY = (dimensions.height - totalButtonsHeight) / 2;

		// Create plus button group
		const buttonGroup = nodeElement.append("g")
			.attr("class", "plus-button-group")
			.attr("transform", `translate(${dimensions.width + 4}, ${buttonY})`);

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
