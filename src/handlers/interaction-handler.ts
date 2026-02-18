/**
 * Mind Map Interaction Handler
 *
 * Handles user interactions with mind map nodes and canvas
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode, MindMapInteractionHandler, EditingState } from '../interfaces/mindmap-interfaces';
import { MindMapConfig } from '../config/types';
import { validateNodeText } from '../utils/mindmap-utils';
import { STYLE_CONSTANTS } from '../constants/mindmap-constants';
import { MindMapMessages } from '../i18n';

export interface InteractionCallbacks {
    onNodeTextChanged?: (node: d3.HierarchyNode<MindMapNode>, newText: string) => void;
    onNodeSelected?: (node: d3.HierarchyNode<MindMapNode>) => void;
    onNodeDoubleClicked?: (node: d3.HierarchyNode<MindMapNode>) => void;
}

/**
 * Interaction handler class
 */
export class D3InteractionHandler implements MindMapInteractionHandler {
    private selectedNode: d3.HierarchyNode<MindMapNode> | null = null;
    private editingState: EditingState = {
        isEditing: false,
        currentNode: null,
        originalText: '',
        editElement: null
    };

    // Double click detection mechanism
    private clickTimeout: number | null = null;
    private lastClickTime = 0;
    private clickNode: d3.HierarchyNode<MindMapNode> | null = null;

    private messages: MindMapMessages;
    private config?: MindMapConfig;

    constructor(private callbacks: InteractionCallbacks = {}, messages?: MindMapMessages, config?: MindMapConfig) {
        this.messages = messages || { errors: {}, notices: {}, ui: {}, validation: {} } as MindMapMessages;
        this.config = config;
    }

    /**
     * Handle node click with double click detection
     */
    handleNodeClick(event: MouseEvent, node: d3.HierarchyNode<MindMapNode>, nodeRect: d3.Selection<SVGRectElement, unknown, null, undefined>): void {
        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastClickTime;
        const isDoubleClick = timeDiff < 300 && this.clickNode === node;

        if (isDoubleClick) {
            this.lastClickTime = 0;
            this.clickNode = null;
            if (this.clickTimeout) {
                clearTimeout(this.clickTimeout);
                this.clickTimeout = null;
            }
            this.handleNodeDoubleClick(node);
        } else {
            this.lastClickTime = currentTime;
            this.clickNode = node;
            this.clickTimeout = window.setTimeout(() => {
                this.performNodeSelection(node, nodeRect);
                this.clickTimeout = null;
                this.clickNode = null;
            }, 250);
        }
    }

    /**
     * Handle node double click for editing
     */
    handleNodeDoubleClick(node: d3.HierarchyNode<MindMapNode>): void {
        // Check if it's the root node, don't allow editing
        if (node.depth === 0) {
            this.showRootNodeEditWarning();
            return;
        }

        if (this.callbacks.onNodeDoubleClicked) {
            this.callbacks.onNodeDoubleClicked(node);
        }
    }

    /**
     * Handle node edit trigger
     */
    handleNodeEdit(event: MouseEvent, node: d3.HierarchyNode<MindMapNode>): void {
        event.stopPropagation();

        // Check if it's the root node, don't allow editing
        if (node.depth === 0) {
            this.showRootNodeEditWarning();
            return;
        }

        try {
            let editElement: HTMLDivElement | null = null;

            // Try to find the unified text element
            editElement = d3.select(event.currentTarget as Element)
                .select(".node-unified-text")
                .node() as HTMLDivElement;

            if (!editElement) {
                // Fallback: try to find from child elements
                const container = event.currentTarget as HTMLElement;
                editElement = container.querySelector('.node-unified-text') as HTMLDivElement;
            }

            if (editElement) {
                this.enableNodeEditing(node, editElement);
            }
        } catch (error) {
        }
    }

    /**
     * Handle canvas click
     */
    handleCanvasClick(event: MouseEvent): void {
        // Clear selection when clicking on empty canvas
        if (this.selectedNode) {
            this.selectedNode.data.selected = false;
            this.selectedNode = null;

            // Update visual state
            d3.selectAll(".node-rect")
                .classed("selected-rect", false);
        }
    }

    /**
     * Handle zoom events
     */
    handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void {
        const { transform } = event;

        // Apply transform to content group
        d3.select(".mind-map-content").attr("transform", transform.toString());
    }

    /**
     * Enable node editing mode
     */
    enableNodeEditing(node: d3.HierarchyNode<MindMapNode>, editElement: HTMLDivElement): void {
        // Check if it's the root node
        if (node.depth === 0) {
            this.showRootNodeEditWarning();
            return;
        }

        if (this.editingState.isEditing && this.editingState.currentNode !== node) {
            this.exitEditMode();
        }

        // Set editing state
        this.editingState = {
            isEditing: true,
            currentNode: node,
            originalText: node.data.text,
            editElement: editElement
        };

        // Enable content editing
        editElement.contentEditable = "true";
        editElement.classList.add("editing");

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(editElement);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }

        // Show editing hint
        this.showEditingHint();

        // Add event listeners
        editElement.addEventListener('keydown', (e) => this.handleEditKeyDown(e, node));
        editElement.addEventListener('blur', () => this.handleEditBlur(node));
    }

    /**
     * Exit editing mode
     */
    exitEditMode(): void {
        if (!this.editingState.isEditing) return;

        const { editElement, currentNode } = this.editingState;

        if (editElement) {
            try {
                // Set to non-editable
                editElement.contentEditable = "false";
                editElement.classList.remove("editing");

                // Note: Event listeners are not explicitly removed
                // This is safe because editingState.isEditing will be false,
                // so the handlers won't execute any editing logic
            } catch (error) {
            }
        }

        // Hide editing hint
        this.hideEditingHint();

        // Clear editing state
        this.editingState = {
            isEditing: false,
            currentNode: null,
            originalText: '',
            editElement: null
        };
    }

    /**
     * Handle keyboard events during editing
     */
    private handleEditKeyDown(event: KeyboardEvent, node: d3.HierarchyNode<MindMapNode>): void {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                this.saveNodeText(node);
                break;
            case 'Escape':
                event.preventDefault();
                this.cancelNodeEdit(node);
                break;
            case 'Tab':
                event.preventDefault();
                // Could implement tab navigation between nodes here
                break;
        }
    }

    /**
     * Handle blur event during editing
     */
    private handleEditBlur(node: d3.HierarchyNode<MindMapNode>): void {
        // Small delay to allow click events to complete
        setTimeout(() => {
            if (this.editingState.isEditing && this.editingState.currentNode === node) {
                this.saveNodeText(node);
            }
        }, 150);
    }

    /**
     * Save node text
     */
    private saveNodeText(node: d3.HierarchyNode<MindMapNode>): void {
        if (!this.editingState.isEditing || !this.editingState.currentNode || !this.editingState.editElement) {
            return;
        }

        const { editElement, currentNode } = this.editingState;
        const newText = editElement.textContent?.trim() || '';

        try {
            // Validate new text
            if (!validateNodeText(newText)) {
                this.showValidationError(this.messages.errors.nodeTextInvalid || "Node text cannot be empty or contain invalid characters");
                // Restore original text
                editElement.textContent = this.editingState.originalText;
                return;
            }

            // Check if text actually changed
            if (newText === this.editingState.originalText) {
                this.exitEditMode();
                return;
            }

            // Update node text
            currentNode.data.text = newText;

            // Trigger callback
            if (this.callbacks.onNodeTextChanged) {
                this.callbacks.onNodeTextChanged(currentNode, newText);
            }

            // Show success message
            this.showEditSuccess("Node text updated successfully");

        } catch (error) {
            this.showValidationError(this.messages.errors.saveFailed || "Failed to save node text");
            // Restore original text
            editElement.textContent = this.editingState.originalText;
        } finally {
            this.exitEditMode();
        }
    }

    /**
     * Cancel node edit
     */
    private cancelNodeEdit(node: d3.HierarchyNode<MindMapNode>): void {
        if (this.editingState.editElement) {
            // Restore original text
            this.editingState.editElement.textContent = this.editingState.originalText;
        }
        this.exitEditMode();
    }

    /**
     * Perform node selection
     */
    private performNodeSelection(node: d3.HierarchyNode<MindMapNode>, nodeRect: d3.Selection<SVGRectElement, unknown, null, undefined>): void {
        // Clear previously selected node
        if (this.selectedNode && this.selectedNode !== node) {
            this.selectedNode.data.selected = false;
            // Update visual state of previously selected node
            d3.selectAll(".node-rect")
                .filter((d: d3.HierarchyNode<MindMapNode>) => d === this.selectedNode)
                .classed("selected-rect", false);
        }

        // Toggle current node selection
        node.data.selected = !node.data.selected;

        if (node.data.selected) {
            this.selectedNode = node;
            nodeRect.classed("selected-rect", true);
        } else {
            this.selectedNode = null;
            nodeRect.classed("selected-rect", false);
        }

        // Trigger callback
        if (this.callbacks.onNodeSelected) {
            this.callbacks.onNodeSelected(node);
        }
    }

    /**
     * Show editing hint
     */
    private showEditingHint(): void {
        let hintElement = document.querySelector('.editing-hint') as HTMLElement;
        if (!hintElement) {
            hintElement = document.createElement('div');
            hintElement.className = 'editing-hint';
            // 根据设备类型选择不同的提示文案
            const editHint = this.config?.isMobile
                ? this.messages.ui.editHintMobile
                : this.messages.ui.editHintDesktop;
            hintElement.textContent = editHint;
            document.body.appendChild(hintElement);
        }
        hintElement.classList.add('show');
    }

    /**
     * Hide editing hint
     */
    private hideEditingHint(): void {
        const hintElement = document.querySelector('.editing-hint') as HTMLElement;
        if (hintElement) {
            hintElement.classList.remove('show');
        }
    }

    /**
     * Show validation error
     */
    private showValidationError(message: string): void {
        const errorElement = document.createElement('div');
        errorElement.className = 'mind-map-validation-error';
        errorElement.textContent = message;
        document.body.appendChild(errorElement);

        // Auto remove after 3 seconds
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 3000);
    }

    /**
     * Show edit success message
     */
    private showEditSuccess(message: string): void {
        const successElement = document.createElement('div');
        successElement.className = 'mind-map-success-message';
        successElement.textContent = message;
        document.body.appendChild(successElement);

        // Auto remove after 2 seconds
        setTimeout(() => {
            if (successElement.parentNode) {
                successElement.parentNode.removeChild(successElement);
            }
        }, 2000);
    }

    /**
     * Show root node edit warning
     */
    private showRootNodeEditWarning(): void {
        new Notice(this.messages.validation.cannotEditRoot || "中心主题（文件名）不允许修改", 3000);
    }

    /**
     * Get current editing state
     */
    getEditingState(): EditingState {
        return { ...this.editingState };
    }

    /**
     * Get currently selected node
     */
    getSelectedNode(): d3.HierarchyNode<MindMapNode> | null {
        return this.selectedNode;
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.exitEditMode();

        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }

        this.selectedNode = null;
        this.clickNode = null;
    }
}