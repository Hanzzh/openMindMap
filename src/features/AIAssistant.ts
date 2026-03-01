/**
 * AI Assistant - AI node suggestion functionality
 *
 * [Responsibilities]
 * - Render AI suggestion button
 * - Trigger AI requests to get child node suggestions
 * - Show suggestion panel
 * - Handle suggestion selection and node creation
 * - Manage loading state and selected suggestions
 *
 * [Design Principles]
 * - Communicate with external via callbacks, no direct dependency on D3TreeRenderer
 * - Manage own state (selectedSuggestions, loadingNotice)
 * - Provide clear API for button rendering and triggering
 *
 * [Refactoring Source]
 * Extracted from D3TreeRenderer.ts (Phase 3.1)
 * - renderAISuggestButton() → renderAIButton()
 * - removeAISuggestButton() → removeAIButton()
 * - triggerAISuggestions() → triggerSuggestions()
 * - showSuggestionsPanel() → showSuggestionsPanel()
 * - createChildFromSuggestion() → createChildFromSuggestion()
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode, NodeDimensions } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n/types';

/**
 * AI Assistant callback interface
 */
export interface AIAssistantCallbacks {
	/**
	 * Called after node is successfully created, used to refresh rendering
	 */
	onNodeCreated?: () => void;
}

/**
 * AI Assistant class
 *
 * Manages complete lifecycle of AI node suggestions
 */
export class AIAssistant {
	// Selected suggestions tracking
	private selectedSuggestions = new Set<string>();

	// AI suggestion loading notice
	private loadingNotice: Notice | null = null;

	// Dependencies
	private mindMapService: MindMapService;
	private messages: MindMapMessages;
	private callbacks: AIAssistantCallbacks;

	constructor(mindMapService: MindMapService, messages: MindMapMessages, callbacks: AIAssistantCallbacks) {
		this.mindMapService = mindMapService;
		this.messages = messages;
		this.callbacks = callbacks;
	}

	/**
	 * Render AI suggestion button
	 *
	 * @param nodeElement Node element selection set
	 * @param node Node data
	 * @param dimensions Node dimensions
	 */
	renderAIButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>,
		node: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): void {
		// Check if AI button already exists
		const existingAIButton = nodeElement.select(".ai-suggest-button-group");
		if (!existingAIButton.empty()) {
			return; // Don't create duplicate if AI button already exists
		}

		// Calculate total height of both buttons (plus button 20px + spacing 10px + AI button 20px = 50px)
		const totalButtonsHeight = 20 + 10 + 20;
		// AI button positioned at bottom: plus button Y position + 20px (plus button height) + 10px (spacing)
		const buttonY = (dimensions.height - totalButtonsHeight) / 2 + 20 + 10;
		const buttonX = dimensions.width + 4; // Horizontally aligned with plus button

		// Create AI suggestion button group
		const buttonGroup = nodeElement.append("g")
			.attr("class", "ai-suggest-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);

		// Add click event handler
		buttonGroup.on("click", (event: MouseEvent) => {
			event.stopPropagation();
			void this.triggerSuggestions(node);
		});

		// Create circular background (purple)
		buttonGroup.append("circle")
			.attr("class", "ai-suggest-button-bg")
			.attr("cx", 10)
			.attr("cy", 10)
			.attr("r", 10)
			.attr("fill", "#9333ea")  // Purple background
			.style("opacity", 0.9)
			.style("cursor", "pointer");

		// Create emoji icon
		buttonGroup.append("text")
			.attr("class", "ai-suggest-button-text")
			.attr("x", 10)
			.attr("y", 10)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "white")
			.attr("font-size", "14px")
			.style("pointer-events", "none")
			.text("✨");

		// Add title tooltip
		buttonGroup.append("title")
			.text("AI Suggestions");
	}

	/**
	 * Remove AI suggestion button
	 *
	 * @param nodeElement Node element selection set
	 */
	removeAIButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>
	): void {
		const buttonGroup = nodeElement.select(".ai-suggest-button-group");
		if (!buttonGroup.empty()) {
			buttonGroup.remove();
		}
	}

	/**
	 * Trigger AI suggestion request
	 *
	 * @param node Node to get suggestions for
	 */
	async triggerSuggestions(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		// Validate service availability
		if (!this.mindMapService) {
			new Notice(this.messages.errors.serviceNotAvailable);
			return;
		}

		// Empty node validation
		const nodeText = node.data.text?.trim() || '';

		if (!nodeText) {
			new Notice(this.messages.errors.emptyNodeError);
			return;
		}

		// Clean up previous loading notice (if exists)
		// Notice: Obsidian's Notice class doesn't have a hide() method
		// We'll reuse the same Notice object by updating its message
		if (!this.loadingNotice) {
			// Create new loading notice (30 second timeout)
			this.loadingNotice = new Notice(this.messages.format(
				this.messages.notices.aiAnalyzing,
				{ nodeText }
			), 30000);
		} else {
			// Update existing notice message
			this.loadingNotice.setMessage(this.messages.format(
				this.messages.notices.aiAnalyzing,
				{ nodeText }
			));
		}

		try {
			// Call MindMapService to get suggestions
			const suggestions = await this.mindMapService.suggestChildNodes(node.data);

			// Clear loading notice reference after success
			// Notice will auto-dismiss after timeout (30 seconds)
			this.loadingNotice = null;

			if (suggestions.length === 0) {
				new Notice(this.messages.notices.aiNoSuggestions);
				return;
			}

			// Show suggestion panel
			this.showSuggestionsPanel(node, suggestions);
		} catch (error) {

			// Clear loading notice reference on error
			// Notice will auto-dismiss after timeout (30 seconds)
			this.loadingNotice = null;

			const errorMsg = this.messages.format(
				this.messages.notices.aiFailed,
				{ error: error instanceof Error ? error.message : String(error) }
			);
			new Notice(errorMsg);
		}
	}

	/**
	 * Show suggestion list panel
	 *
	 * @param node Parent node
	 * @param suggestions Suggestion list
	 */
	private showSuggestionsPanel(
		node: d3.HierarchyNode<MindMapNode>,
		suggestions: string[]
	): void {
		// Remove old panel
		this.hideSuggestionsPanel();

		// Create panel container
		const panel = document.createElement("div");
		panel.className = "ai-suggestions-panel";

		// Title and action buttons area
		const header = document.createElement("div");
		header.className = "ai-suggestions-header";

		const title = document.createElement("h4");
		title.textContent = this.messages.ui.aiSuggestionsTitle;

		// Action buttons container
		const actionButtons = document.createElement("div");
		actionButtons.className = "ai-suggestions-actions";

		// Select all button
		const selectAllBtn = document.createElement("button");
		selectAllBtn.className = "ai-suggestions-select-all";
		selectAllBtn.textContent = this.messages.ui.aiAddAll;
		selectAllBtn.title = this.messages.ui.aiAddAllTooltip;
		selectAllBtn.onclick = () => {
			suggestions.forEach(suggestion => {
				if (!this.selectedSuggestions.has(suggestion)) {
					// Find corresponding list item
					const listItem = Array.from(list.children).find(
						item => item.textContent?.includes(suggestion)
					) as HTMLElement;
					this.createChildFromSuggestion(node, suggestion, listItem);
				}
			});
		};

		// Close button
		const closeBtn = document.createElement("button");
		closeBtn.className = "ai-suggestions-close";
		closeBtn.textContent = this.messages.ui.aiClose;
		closeBtn.onclick = () => this.hideSuggestionsPanel();

		actionButtons.appendChild(selectAllBtn);
		actionButtons.appendChild(closeBtn);
		header.appendChild(title);
		header.appendChild(actionButtons);
		panel.appendChild(header);

		// Suggestion list
		const list = document.createElement("ul");
		list.className = "ai-suggestions-list";

		suggestions.forEach((suggestion) => {
			const item = document.createElement("li");
			item.className = "ai-suggestion-item";

			// Check if already selected (for panel reopen scenario)
			const isSelected = this.selectedSuggestions.has(suggestion);
			if (isSelected) {
				item.classList.add('ai-suggestion-item-selected');
			}

			// Create checkmark placeholder element
			const checkmark = document.createElement("span");
			checkmark.className = "ai-suggestion-checkmark";
			checkmark.textContent = isSelected ? '✓' : '';

			// Create suggestion text
			const text = document.createElement("span");
			text.className = "ai-suggestion-text";
			text.textContent = suggestion;

			item.appendChild(checkmark);
			item.appendChild(text);

			// Click event: only create if not selected
			item.onclick = () => {
				if (!this.selectedSuggestions.has(suggestion)) {
					this.createChildFromSuggestion(node, suggestion, item);
				} else {
					new Notice(this.messages.format(
						this.messages.notices.alreadyAdded || `Already added: {nodeText}`,
						{ nodeText: suggestion }
					));
				}
			};

			list.appendChild(item);
		});

		panel.appendChild(list);

		// Add to document.body (avoid being removed by re-rendering)
		document.body.appendChild(panel);
	}

	/**
	 * Close suggestion panel
	 */
	private hideSuggestionsPanel(): void {
		const panel = document.querySelector(".ai-suggestions-panel");
		if (panel) {
			panel.remove();
		}
	}

	/**
	 * Create child node from suggestion
	 *
	 * @param parentNode Parent node
	 * @param suggestion Suggestion text
	 * @param listItemElement List item element (optional, for updating UI)
	 */
	private createChildFromSuggestion(
		parentNode: d3.HierarchyNode<MindMapNode>,
		suggestion: string,
		listItemElement?: HTMLElement
	): void {
		// Prevent duplicate creation of same suggestion
		if (this.selectedSuggestions.has(suggestion)) {
			new Notice(this.messages.format(
				this.messages.notices.alreadyAdded || `Already added: {nodeText}`,
				{ nodeText: suggestion }
			));
			return;
		}

		try {
			// Create child node
			this.mindMapService.createChildNode(parentNode.data, suggestion);

			// Track selected suggestion
			this.selectedSuggestions.add(suggestion);

			// Refresh rendering
			this.callbacks.onNodeCreated?.();

			// Mark list item as selected (if list item element provided)
			if (listItemElement) {
				listItemElement.classList.add('ai-suggestion-item-selected');
				// Show checkmark icon
				const checkmark = listItemElement.querySelector('.ai-suggestion-checkmark');
				if (checkmark) {
					checkmark.textContent = '✓';
				}
			}

			// Show success notice
			new Notice(this.messages.format(
				this.messages.notices.nodeCreated || `Created: {nodeText}`,
				{ nodeText: suggestion }
			));

			// No longer auto-close panel, allow user to continue selecting other suggestions
		} catch (error) {
			new Notice(this.messages.format(
				this.messages.notices.nodeCreateFailed || `Failed to create node: {error}`,
				{ error: error instanceof Error ? error.message : String(error) }
			));
		}
	}

	/**
	 * Clear selected suggestions tracking
	 *
	 * Called when switching to different nodes or reopening mind map
	 */
	clearSelectedSuggestions(): void {
		this.selectedSuggestions.clear();
	}

	/**
	 * Destroy AI Assistant
	 *
	 * Clean up resources and hide panel
	 */
	destroy(): void {
		// Hide suggestion panel
		this.hideSuggestionsPanel();

		// Clear loading notice reference
		// Notice will auto-dismiss after timeout (30 seconds)
		this.loadingNotice = null;

		// Clear selected suggestions
		this.selectedSuggestions.clear();
	}
}
