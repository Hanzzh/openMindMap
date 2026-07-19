/**
 * Node Editor - Node editing functionality
 *
 * [Responsibilities]
 * - Enter/exit edit mode
 * - Text validation
 * - Save/cancel editing
 * - Edit UI hints
 * - Handle edit keyboard shortcuts
 *
 * [Design Principles]
 * - Communicate with external via callbacks, no direct dependency on D3TreeRenderer
 * - Manage own state (editingState, canvasInteractionEnabled)
 * - Provide clear API for edit operations
 *
 * [Refactoring Source]
 * Extracted from D3TreeRenderer.ts (Phase 3.2)
 * - enableNodeEditing() → enableEditing()
 * - exitEditMode() → exitEditMode()
 * - cancelEditMode() → cancelEdit()
 * - saveNodeText() → saveText()
 * - validateNodeText() → validateText()
 * - showValidationError() → showValidationError()
 * - showEditingHint() → showEditingHint()
 * - hideEditingHint() → hideEditingHint()
 * - showRootNodeEditWarning() → showRootNodeEditWarning()
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode, EditingState } from '../interfaces/mindmap-interfaces';
import { MindMapConfig } from '../config/types';
import { MindMapMessages } from '../i18n';
import { VALIDATION_CONSTANTS } from '../constants/mindmap-constants';
import { Logger } from '../utils/logger';

/**
 * Node Editor callback interface
 */
export interface NodeEditorCallbacks {
	/**
	 * Called before text changes, used to save undo snapshot
	 */
	onBeforeTextChange?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * Called after text changes, used to trigger file save
	 */
	onTextChanged?: (node: d3.HierarchyNode<MindMapNode>, newText: string) => void;

	/**
	 * Called when canvas interaction state changes
	 */
	onCanvasInteractionChanged?: (enabled: boolean) => void;
}

/**
 * Node Editor class
 *
 * Manages complete lifecycle of node editing
 */
export class NodeEditor {
	// Editing state
	private editingState: EditingState;

	// Canvas interaction state
	private canvasInteractionEnabled = true;

	constructor(
		private config: MindMapConfig,
		private messages: MindMapMessages,
		private callbacks: NodeEditorCallbacks = {},
		editingState?: EditingState  // ✅ Accept external editingState
	) {
		// If not provided, create internal state (backward compatible)
		this.editingState = editingState || {
			isEditing: false,
			currentNode: null,
			originalText: '',
			editElement: null
		};
	}

	/**
	 * Enable node editing mode
	 *
	 * @param node Node to edit
	 * @param editElement Editable text element
	 */
	enableEditing(
		node: d3.HierarchyNode<MindMapNode>,
		editElement: HTMLDivElement
	): void {
		const logger = Logger.getInstance();

		// Check if it's root node (central topic), not allowed to edit
		if (node.depth === 0) {
			// Debug mode: 双击根节点作为日志导出入口（替代命令/ribbon，iPad 友好）
			// Non-debug mode: 保持既有 showRootNodeEditWarning() 行为，完全不变
			if (logger.isDebugEnabled()) {
				logger.snapshotViewport('NodeEditor', 'enableEditing: root node clicked, flushing logs');
				void logger.flushToClipboard();
			} else {
				this.showRootNodeEditWarning();
			}
			return;
		}

		logger.debug('NodeEditor', 'enableEditing: begin', {
			nodeText: node.data.text,
			nodeLevel: node.data.level,
			depth: node.depth,
			isCurrentlyEditing: this.editingState.isEditing,
			editElementInDOM: document.body.contains(editElement)
		});
		logger.snapshotViewport('NodeEditor', 'enableEditing: before applying edit state');

		// If editing another node, exit edit mode first
		if (this.editingState.isEditing && this.editingState.currentNode !== node) {
			logger.debug('NodeEditor', 'enableEditing: switching from another node, exiting previous edit');
			this.exitEditMode();
		}

		// Disable canvas interaction (drag, zoom), allow text selection and editing
		this.setCanvasInteraction(false);

		// Set editing state (modify properties, don't reassign object)
		this.editingState.isEditing = true;
		this.editingState.currentNode = node;
		this.editingState.originalText = node.data.text;
		this.editingState.editElement = editElement;

		try {
			// Set to editable
			editElement.contentEditable = "true";

			// Add editing style class
			editElement.classList.add("editing");

			// Add node editing state
			const nodeElement = d3.select(editElement.closest("g"));
			nodeElement.classed("node-editing", true);

			logger.debugLazy('NodeEditor', 'enableEditing: edit state applied', () => {
				const rect = editElement.getBoundingClientRect();
				return {
					contentEditable: editElement.contentEditable,
					className: editElement.className,
					rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
				};
			});

			// Set focus and select all text (use setTimeout to ensure event handling completes)
			setTimeout(() => {
				try {
					logger.snapshotViewport('NodeEditor', 'enableEditing: setTimeout(10ms) before focus()');

					editElement.focus();

					logger.snapshotViewport('NodeEditor', 'enableEditing: setTimeout(10ms) after focus()', {
						activeIsEditElement: document.activeElement === editElement
					});

					// Select all text - use range.selectNodeContents (consistent with tmp branch)
					const range = document.createRange();
					range.selectNodeContents(editElement);
					const selection = window.getSelection();
					if (selection) {
						selection.removeAllRanges();
						selection.addRange(range);
					}
				} catch (err) {
					logger.error('NodeEditor', 'enableEditing: focus() failed', err);
					this.showValidationError(this.messages.errors.focusSetFailed);
					this.exitEditMode();
				}
			}, 10);

			// Show editing hint (delayed call to avoid interfering with focus)
			setTimeout(() => {
				this.showEditingHint();
			}, 100);

		} catch (err) {
			logger.error('NodeEditor', 'enableEditing: enter edit mode failed', err);
			this.showValidationError(this.messages.errors.enterEditModeFailed);
			this.exitEditMode();
		}
	}

	/**
	 * Exit edit mode
	 */
	exitEditMode(): void {
		if (!this.editingState.isEditing) return;

		// Capture caller stack to identify who triggered exit (useful for iPad keyboard debugging)
		Logger.getInstance().debugLazy('NodeEditor', 'exitEditMode: called', () => ({
			stack: new Error().stack?.split('\n').slice(0, 8),
			nodeText: this.editingState.currentNode?.data.text,
			originalText: this.editingState.originalText
		}));

		const { editElement } = this.editingState;

		// Restore canvas interaction
		this.setCanvasInteraction(true);

		if (editElement) {
			try {
				// Set to non-editable
				editElement.contentEditable = "false";
				editElement.classList.remove("editing");

				// Clear text selection to prevent text remaining selected after exiting edit mode
				const selection = window.getSelection();
				if (selection) {
					selection.removeAllRanges();
				}

				// Remove node editing state
				const nodeElement = d3.select(editElement.closest("g"));
				nodeElement.classed("node-editing", false);
			} catch {
				// Ignore errors when cleaning up DOM elements
			}
		}

		// Hide editing hint
		this.hideEditingHint();

		// Reset editing state (clear properties, don't reassign object)
		this.editingState.isEditing = false;
		this.editingState.currentNode = null;
		this.editingState.originalText = '';
		this.editingState.editElement = null;

		Logger.getInstance().snapshotViewport('NodeEditor', 'exitEditMode: completed');
	}

	/**
	 * Cancel edit mode (restore original text)
	 */
	cancelEdit(): void {
		if (!this.editingState.isEditing) return;

		Logger.getInstance().debug('NodeEditor', 'cancelEdit: called', {
			nodeText: this.editingState.currentNode?.data.text,
			originalText: this.editingState.originalText
		});

		const { editElement } = this.editingState;

		// Restore original text
		if (editElement && this.editingState.originalText) {
			editElement.textContent = this.editingState.originalText;
		}

		// Call exitEditMode for cleanup
		// Since text is restored, save check in exitEditMode will be skipped (because currentText === originalText)
		this.exitEditMode();
	}

	/**
	 * Save node text
	 */
	saveText(): void {
		const logger = Logger.getInstance();

		if (!this.editingState.isEditing ||
			!this.editingState.currentNode ||
			!this.editingState.editElement) {
			logger.debug('NodeEditor', 'saveText: early return, not editing');
			return;
		}

		const { editElement, currentNode } = this.editingState;
		const newText = editElement.textContent?.trim() || '';

		logger.debug('NodeEditor', 'saveText: begin', {
			nodeText: currentNode.data.text,
			newText,
			originalText: this.editingState.originalText,
			changed: newText !== this.editingState.originalText
		});

		try {
			// Validate new text
			if (!this.validateText(newText)) {
				logger.debug('NodeEditor', 'saveText: validation failed (empty/invalid)');
				this.showValidationError(this.messages.errors.nodeTextEmpty);
				return;
			}

			// Check if text really changed
			if (newText === this.editingState.originalText) {
				logger.debug('NodeEditor', 'saveText: text unchanged, exiting edit mode');
				this.exitEditMode();
				return;
			}

			// Save snapshot before modification
			this.callbacks.onBeforeTextChange?.(currentNode);

			// Update data structure
			currentNode.data.text = newText;

			// Trigger file save callback
			this.callbacks.onTextChanged?.(currentNode, newText);

			logger.debug('NodeEditor', 'saveText: text saved', {
				newText,
				nodeLevel: currentNode.data.level
			});

		} catch (err) {
			logger.error('NodeEditor', 'saveText: failed', err);
			this.showValidationError(this.messages.errors.saveFailed);
			// Restore original text
			editElement.textContent = this.editingState.originalText;
		}

		this.exitEditMode();
	}

	/**
	 * Validate node text
	 *
	 * @param text Text to validate
	 * @returns Whether valid
	 */
	validateText(text: string): boolean {
		// Check if empty or only whitespace
		if (!text || text.trim().length === 0) {
			return false;
		}

		// Check length limit (using config constants)
		if (text.length > VALIDATION_CONSTANTS.MAX_TEXT_LENGTH) {
			return false;
		}

		// Check for invalid characters
		const invalidChars = VALIDATION_CONSTANTS.INVALID_CHARACTERS;
		if (invalidChars.some(char => text.includes(char))) {
			return false;
		}

		return true;
	}

	/**
	 * Get current editing state (read-only)
	 * Note: Returns real reference, used by TextRenderer and other modules to check state
	 */
	getEditingState(): Readonly<EditingState> {
		return this.editingState;
	}

	/**
	 * Whether currently editing
	 */
	isEditing(): boolean {
		return this.editingState.isEditing;
	}

	/**
	 * Check if canvas interaction is enabled
	 */
	isCanvasInteractionEnabled(): boolean {
		return this.canvasInteractionEnabled;
	}

	/**
	 * Destroy
	 */
	destroy(): void {
		// Exit edit mode (if editing)
		this.exitEditMode();
		// Hide editing hint
		this.hideEditingHint();
	}

	// ========== Private Methods ==========

	/**
	 * Set canvas interaction state
	 */
	private setCanvasInteraction(enabled: boolean): void {
		this.canvasInteractionEnabled = enabled;
		this.callbacks.onCanvasInteractionChanged?.(enabled);
	}

	/**
	 * Show editing hint
	 */
	private showEditingHint(): void {
		let hintElement = document.querySelector('.editing-hint');
		if (!hintElement) {
			hintElement = document.createElement('div');
			hintElement.className = 'editing-hint';
			// Select different hint text based on device type
			const editHint = this.config.isMobile
				? this.messages.ui.editHintMobile
				: this.messages.ui.editHintDesktop;
			// Use textContent for security (XSS prevention)
			hintElement.textContent = editHint;
			document.body.appendChild(hintElement);
		}
		hintElement.classList.add('show');
	}

	/**
	 * Hide editing hint
	 */
	private hideEditingHint(): void {
		const hintElement = document.querySelector('.editing-hint');
		if (hintElement) {
			hintElement.classList.remove('show');
		}
	}

	/**
	 * Show root node edit warning
	 */
	private showRootNodeEditWarning(): void {
		new Notice(this.messages.validation.cannotEditRoot, 3000);
	}

	/**
	 * Show validation error
	 */
	private showValidationError(message: string): void {
		// Create temporary error hint
		const errorElement = document.createElement('div');
		errorElement.className = 'mind-map-validation-error';
		errorElement.textContent = message;
		document.body.appendChild(errorElement);

		// Auto remove after 3 seconds
		setTimeout(() => {
			errorElement.classList.add('fading-out');
			setTimeout(() => {
				if (errorElement.parentNode) {
					errorElement.parentNode.removeChild(errorElement);
				}
			}, 200);
		}, 3000);

		// Try to recover if in editing state
		if (this.editingState.isEditing) {
			try {
				this.exitEditMode();
			} catch {
				// Ignore errors during recovery attempt
			}
		}
	}
}
