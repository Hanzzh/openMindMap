/**
 * Clipboard Manager - Clipboard management functionality
 *
 * [Responsibilities]
 * - Copy node/subtree to clipboard (markdown format)
 * - Paste text from clipboard to create child node/subtree
 * - Cut node (copy + delete)
 * - Clipboard content format detection (markdown vs plain text)
 * - Success/failure notifications
 *
 * [Design Principles]
 * - Communicate with external via callbacks, no direct dependency on D3TreeRenderer
 * - Manage own clipboard operations
 * - Provide clear API for clipboard operations
 * - Use modern Clipboard API (Obsidian/Electron support)
 *
 * [Refactoring Source]
 * Extracted from D3TreeRenderer.ts (Phase 3.3)
 * - handleToolbarCopyClick() → copyNode()
 * - handleToolbarPasteClick() → pasteToNode()
 * - showCopySuccessNotice() → (built-in)
 * - showCopyErrorNotice() → (built-in)
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n';
import { VALIDATION_CONSTANTS } from '../constants/mindmap-constants';

/**
 * Clipboard Manager callback interface
 */
export interface ClipboardManagerCallbacks {
	/**
	 * Called when data needs to be refreshed after pasting
	 */
	onDataUpdated?: () => void;

	/**
	 * Called when selection needs to be cleared after pasting
	 */
	clearSelection?: () => void;
}

/**
 * Clipboard Manager class
 *
 * Manages complete lifecycle of clipboard operations
 */
export class ClipboardManager {

	constructor(
		private mindMapService: MindMapService,
		private messages: MindMapMessages,
		private callbacks: ClipboardManagerCallbacks = {}
	) {
		// Instance variables are used in class methods
	}

	/**
	 * Copy node to clipboard (serialize as markdown format)
	 *
	 * @param node Node to copy
	 * @returns Promise<boolean> Whether successful
	 */
	async copyNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		try {
			// Serialize entire subtree to markdown format
			const markdown = this.mindMapService.serializeSubtreeToMarkdown(node.data);

			// Use modern Clipboard API
			await navigator.clipboard.writeText(markdown);
			this.showSuccessNotice(this.messages.notices.nodeTextCopied);
			return true;
		} catch {
			this.showErrorNotice(this.messages.notices.copyFailed);
			return false;
		}
	}

	/**
	 * Cut node (copy + delete)
	 *
	 * @param node Node to cut
	 * @returns Promise<boolean> Whether successful
	 */
	async cutNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		// Perform copy operation first
		const copySuccess = await this.copyNode(node);

		if (copySuccess) {
			// Perform delete after successful copy
			const deleteSuccess = this.mindMapService.deleteNode(node.data);

			if (deleteSuccess) {
				// Clear selected state
				this.callbacks.clearSelection?.();

				// Trigger data update
				this.callbacks.onDataUpdated?.();
				return true;
			}
		}

		return false;
	}

	/**
	 * Paste clipboard content to node
	 *
	 * @param node Target node (will be used as parent node)
	 * @returns Promise<boolean> Whether successful
	 */
	async pasteToNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		try {
			// Check if Clipboard API is available
			if (!navigator.clipboard || !window.isSecureContext) {
				return false;
			}

			// Read clipboard content
			const clipboardText = await navigator.clipboard.readText();

			// Silent failure: if clipboard is empty or cannot be read, return directly
			if (!clipboardText || clipboardText.trim().length === 0) {
				return false;
			}

			// Check if clipboard content is markdown format (contains list markers)
			const isMarkdownFormat = /^\s*[-*]/m.test(clipboardText);

			if (isMarkdownFormat) {
				// If markdown format, try to create subtree
				return this.pasteSubtree(node, clipboardText);
			} else {
				// Plain text, create single child node
				return this.pasteText(node, clipboardText);
			}
		} catch {
			// Silent failure: don't show any error message
			return false;
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
	 * Paste subtree (markdown format)
	 */
	private pasteSubtree(
		node: d3.HierarchyNode<MindMapNode>,
		clipboardText: string
	): boolean {
		// Try to create subtree from markdown
		const subtreeRoot = this.mindMapService.createSubtreeFromMarkdown(
			clipboardText,
			node.data.level
		);

		if (subtreeRoot) {
			// Set parent node
			subtreeRoot.parent = node.data;
			node.data.children.push(subtreeRoot);

			// Clear current selection
			this.callbacks.clearSelection?.();

			// Fix: Set selected state directly at data layer
			subtreeRoot.selected = true;

			// Trigger data update
			this.callbacks.onDataUpdated?.();
			return true;
		} else {
			// If parsing fails, fallback to plain text handling
			return this.pasteText(node, clipboardText);
		}
	}

	/**
	 * Paste plain text (create single child node)
	 */
	private pasteText(
		node: d3.HierarchyNode<MindMapNode>,
		clipboardText: string
	): boolean {
		// Limit text length to maximum allowed length
		const truncatedText = clipboardText.substring(0, VALIDATION_CONSTANTS.MAX_TEXT_LENGTH);

		// Create child node
		const childNode = this.mindMapService.createChildNode(node.data, truncatedText);

		// Clear current selection
		this.callbacks.clearSelection?.();

		// Fix: Set selected state directly at data layer
		childNode.selected = true;

		// Trigger data update
		this.callbacks.onDataUpdated?.();
		return true;
	}

	/**
	 * Show success notice
	 */
	private showSuccessNotice(message: string): void {
		new Notice(message, 2000);
	}

	/**
	 * Show error notice
	 */
	private showErrorNotice(message: string): void {
		new Notice(message, 3000);
	}
}
