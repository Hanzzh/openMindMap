/**
 * Renderer Coordinator - Main Rendering Coordinator
 *
 * [Responsibilities]
 * - Integrate all feature modules (interaction, editing, AI, clipboard, buttons, toolbar)
 * - Coordinate rendering and interaction
 * - Implement MindMapRenderer interface
 * - Manage lifecycle
 *
 * [Design Principles]
 * - Composition over inheritance: Use multiple specialized modules instead of a single monolithic class
 * - Single responsibility: Each module handles specific functionality
 * - Inter-module communication via callbacks
 * - Maintain backward compatibility: Implement MindMapRenderer interface
 *
 * [Architecture]
 * - Core rendering: Retain necessary SVG rendering logic
 * - Feature modules: Use 6 modules extracted from Phase 3
 * - Event coordination: Unified management through InteractionManager
 */

import * as d3 from 'd3';
import { MindMapData, MindMapRenderer, EditingState, MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapConfig } from '../config/types';
import { MindMapMessages } from '../i18n';
import { UndoManager } from '../managers/UndoManager';

// Import core renderers
import { TextMeasurer } from '../utils/TextMeasurer';
import { LayoutCalculator } from './layout-calculator';
import { NodeRenderer } from './core/NodeRenderer';
import { LinkRenderer } from './core/LinkRenderer';
import { TextRenderer } from './core/TextRenderer';

// Import feature modules
import { InteractionManager, RenderCallbacks } from '../interactions/interaction-manager';
import { AIAssistant, AIAssistantCallbacks } from '../features/AIAssistant';
import { NodeEditor, NodeEditorCallbacks } from '../features/NodeEditor';
import { ClipboardManager, ClipboardManagerCallbacks } from '../features/ClipboardManager';
import { ButtonRenderer, ButtonRendererCallbacks } from '../features/ButtonRenderer';
import { MobileToolbar, MobileToolbarCallbacks } from '../features/MobileToolbar';

/**
 * Renderer Coordinator Class
 *
 * Replaces D3TreeRenderer, integrates all feature modules
 */
export class RendererCoordinator implements MindMapRenderer {
	// ========== Core Rendering Components ==========
	private textMeasurer: TextMeasurer;
	private layoutCalculator: LayoutCalculator;
	private nodeRenderer: NodeRenderer;
	private linkRenderer: LinkRenderer;
	private textRenderer: TextRenderer;

	// ========== Feature Modules ==========
	private interactionManager: InteractionManager;
	private aiAssistant: AIAssistant;
	private nodeEditor: NodeEditor;
	private clipboardManager: ClipboardManager;
	private buttonRenderer: ButtonRenderer;
	private mobileToolbar: MobileToolbar;
	private undoManager: UndoManager;

	// ========== State Management ==========
	private currentSvg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
	private currentContent: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
	private currentZoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
	private currentZoomTransform = d3.zoomIdentity;
	private currentData: MindMapData | null = null;

	// View state
	private isRendering = false;
	private pendingRenderRequest = false;

	// Selection state
	private selectedNode: d3.HierarchyNode<MindMapNode> | null = null;
	private hoveredNode: d3.HierarchyNode<MindMapNode> | null = null;

	// Editing state (shared with all modules)
	private editingState: EditingState = {
		isEditing: false,
		currentNode: null,
		originalText: '',
		editElement: null
	};

	// Canvas interaction state
	private canvasInteractionEnabled = true;

	// Layout configuration system
	private layoutConfig = {
		minNodeGap: 25,
		lineOffset: 6,
		horizontalSpacing: 170,
		verticalSpacing: 110,
		minVerticalGap: 25,
		treeHeight: 800,
		treeWidth: 1200,
		nodeHeightBuffer: 15,
	};

	// Configuration and messages
	private config: MindMapConfig;
	private messages: MindMapMessages;

	// Callbacks
	onDataUpdated?: () => void;
	onTextChanged?: (node: d3.HierarchyNode<MindMapNode>, newText: string) => void;
	onDataRestored?: (data: MindMapData) => void;

	constructor(
		private mindMapService: MindMapService,
		config?: MindMapConfig,
		messages?: MindMapMessages,
		private isActiveView?: () => boolean
	) {
		this.config = config || { isMobile: false } as MindMapConfig;
		this.messages = messages || {} as MindMapMessages;

		// Warning: if messages is empty, indicates missing i18n support
		if (!messages) {
			// Messages will use default English fallback
		}

		// Initialize UndoManager
		this.undoManager = new UndoManager();

		// Initialize core renderers
		this.initializeCoreRenderers();

		// Initialize feature modules
		this.initializeFeatureModules();
	}

	// ========== Initialization ==========

	private initializeCoreRenderers(): void {
		this.textMeasurer = new TextMeasurer();
		this.layoutCalculator = new LayoutCalculator();
		this.nodeRenderer = new NodeRenderer(this.textMeasurer, this.layoutCalculator);
		this.linkRenderer = new LinkRenderer(this.textMeasurer, { lineOffset: this.layoutConfig.lineOffset });
		this.textRenderer = new TextRenderer(this.textMeasurer, this.config, this.editingState);
	}

	private initializeFeatureModules(): void {
		// 1. Interaction Manager (coordinates all other modules)
		const renderCallbacks: RenderCallbacks = {
			onNodeSelected: (node) => this.handleNodeSelected(node),
			onNodeHovered: (node) => this.handleNodeHovered(node),
			onNodeLeft: (node) => this.handleNodeLeft(node),
			onSelectionCleared: () => this.handleSelectionCleared(),
			onNodeDoubleClicked: (node, event) => this.handleNodeDoubleClicked(node, event),
			onAddChildNode: (node) => this.handleAddChildNode(node),
			onAddSiblingNode: (node) => this.handleAddSiblingNode(node),
			onDeleteNode: (node) => this.handleDeleteNode(node),
			onCopyNode: (node) => this.handleCopyNode(node),
			onCutNode: (node) => this.handleCutNode(node),
			onPasteToNode: (node) => this.handlePasteToNode(node),
			onExitEditMode: () => this.handleExitEditMode(),
			onUndo: () => this.undo(),
			onRedo: () => this.redo()
		};

		this.interactionManager = new InteractionManager(this.config, renderCallbacks, this.isActiveView);

		// 2. AI Assistant
		const aiCallbacks: AIAssistantCallbacks = {
			onNodeCreated: () => this.triggerDataUpdate()
		};
		this.aiAssistant = new AIAssistant(this.mindMapService, this.messages, aiCallbacks);

		// 3. Node Editor
		const editorCallbacks: NodeEditorCallbacks = {
			onBeforeTextChange: (node) => {
				// Save snapshot (before modification)
				if (this.currentData) {
					this.undoManager.saveSnapshot(this.currentData);
				}
			},
			onTextChanged: (node, newText) => {
				this.onTextChanged?.(node, newText);
			},
			onCanvasInteractionChanged: (enabled) => {
				this.canvasInteractionEnabled = enabled;
				// Sync editing state to InteractionManager
				this.interactionManager.syncEditingState(!enabled);
			}
		};
		this.nodeEditor = new NodeEditor(this.config, this.messages, editorCallbacks, this.editingState);

		// 4. Clipboard Manager
		const clipboardCallbacks: ClipboardManagerCallbacks = {
			onDataUpdated: () => this.triggerDataUpdate(),
			clearSelection: () => this.clearSelection()
		};
		this.clipboardManager = new ClipboardManager(this.mindMapService, this.messages, clipboardCallbacks);

		// 5. Button Renderer
		const buttonCallbacks: ButtonRendererCallbacks = {
			onAddChildNode: (node) => this.handleAddChildNode(node),
			enterEditMode: (node) => this.enterEditModeForNode(node),
			clearSelection: () => this.clearSelection(),
			selectNode: (node) => this.selectNode(node),
			onDataUpdated: () => this.triggerDataUpdate()
		};
		this.buttonRenderer = new ButtonRenderer(
			this.mindMapService,
			this.textMeasurer,
			buttonCallbacks
		);

		// 6. Mobile Toolbar (mobile only)
		if (this.config.isMobile) {
			const toolbarCallbacks: MobileToolbarCallbacks = {
				onEdit: (node) => this.enterEditModeForNode(node),
				onCopy: async (node) => {
					await this.clipboardManager.copyNode(node);
				},
				onPaste: async (node) => {
					await this.clipboardManager.pasteToNode(node);
				},
				onDelete: (node) => this.handleDeleteNode(node)
			};
			this.mobileToolbar = new MobileToolbar(
				this.textMeasurer,
				this.messages,
				toolbarCallbacks
			);
		}
	}

	// ========== MindMapRenderer Interface Implementation ==========

	render(container: Element, data: MindMapData): void {
		// Render lock mechanism
		if (this.isRendering) {
			this.pendingRenderRequest = true;
			return;
		}
		this.isRendering = true;

		// Save current data reference (for undo/redo)
		this.currentData = data;

		// Validate selection state (before creating D3 hierarchy)
		this.validateSelectionState();

		// Declare outside try block so finally block can access it
		let root: d3.HierarchyNode<MindMapNode>;

		try {
			// Clear container - use D3 method instead of innerHTML, preserve object references
			d3.select(container).selectAll('*').remove();

			// Create SVG
			const svg = d3.select(container).append('svg')
				.attr('width', '100%')
				.attr('height', '100%')
				.style('position', 'relative');

			this.currentSvg = svg;

			// Create content group
			this.currentContent = svg.append('g')
				.attr('class', 'mindmap-content');

			// Calculate layout - create D3 hierarchy
			root = d3.hierarchy(data.rootNode);

			// Calculate dynamic tree height
			const dynamicTreeHeight = this.calculateDynamicTreeHeight(root);

			// Update LayoutCalculator configuration
			this.layoutCalculator.updateConfig({
				treeHeight: dynamicTreeHeight
			});

			// Apply custom tree layout
			this.layoutCalculator.createCustomTreeLayout(root, (depth, text) =>
				this.textMeasurer.getNodeDimensions(depth, text)
			);

			// Create SVG gradient definitions
			this.createGradientDefinitions(svg);

			// Setup zoom - set before rendering nodes (reference pre-refactor implementation)
			this.setupZoom(svg, container);

			// Immediately apply saved zoom state (prevent visual jump)
			if (this.currentZoomTransform) {
				svg.call((selection) => this.currentZoom.transform(selection, this.currentZoomTransform));
				this.currentContent.attr("transform", this.currentZoomTransform.toString());
			}

			// Offset (center offset, temporarily using 0)
			const offsetX = 0;
			const offsetY = 0;

			// Render links
			this.renderLinks(root, offsetX, offsetY);

			// Render nodes
			this.renderNodes(root, offsetX, offsetY);

			// Restore view state
			this.restoreViewState();

			// Apply initial view position
			this.applyInitialViewPosition(root, svg, this.currentZoom, container);

		} finally {
			this.isRendering = false;

			// Handle pending render request
			if (this.pendingRenderRequest) {
				this.pendingRenderRequest = false;
				setTimeout(() => {
					this.render(container, data);
				}, 16); // Approximately one frame
			}

			// Sync node references
			this.syncSelectedNodeReference(root);

			// Mobile: recreate toolbar (ensure toolbar always exists and is unique)
			if (this.config.isMobile && this.mobileToolbar) {
				this.mobileToolbar.create(this.currentSvg);
			}

			// Restore UI state (if there's a selected node, show toolbar)
			this.restoreSelectionUI();
		}
	}

	destroy(): void {
		// Destroy all modules
		this.mobileToolbar?.destroy();
		this.buttonRenderer.destroy();
		this.clipboardManager.destroy();
		this.nodeEditor.destroy();
		this.aiAssistant.destroy();
		this.interactionManager.destroy();

		// Clean up SVG
		if (this.currentSvg) {
			this.currentSvg.selectAll('*').remove();
			this.currentSvg = null;
		}
		this.currentContent = null;
	}

	// ========== Public Methods (Compatibility Interface) ==========

	/**
	 * Save current view state
	 * Note: This method is kept for compatibility, view state is actually saved automatically in render()
	 */
	public saveViewState(): void {
		// View state is automatically saved internally during render()
		// This method is kept for backward compatibility
		if (this.currentSvg && this.currentZoom) {
			const svgNode = this.currentSvg.node();
			if (svgNode) {
				this.currentZoomTransform = d3.zoomTransform(svgNode);
			}
		}
	}

	/**
	 * Exit edit mode
	 * Note: This method is kept for compatibility, edit state is actually managed by NodeEditor
	 */
	public exitEditMode(): void {
		// Edit state is automatically managed by NodeEditor
		// This method is kept for backward compatibility
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.exitEditMode();
		}
	}

	/**
	 * Save node text
	 * Called by TextRenderer's keyboard event handler
	 * Triggered when pressing Enter in edit mode
	 */
	public saveNodeText(): void {
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.saveText();
		}
		// else: Not in editing mode, nothing to save
	}

	/**
	 * Cancel edit mode
	 * Called by TextRenderer's keyboard event handler
	 * Triggered when pressing Escape in edit mode
	 */
	public cancelEditMode(): void {
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.cancelEdit();
		}
	}

	// ========== Private Rendering Methods ==========

	private renderLinks(root: d3.HierarchyNode<MindMapNode>, offsetX: number, offsetY: number): void {
		// Use LinkRenderer to render links
		this.linkRenderer.renderLinks(this.currentContent, root.links(), offsetX, offsetY);
	}

	private renderNodes(root: d3.HierarchyNode<MindMapNode>, offsetX: number, offsetY: number): void {
		// Use NodeRenderer to render node rectangles
		const nodeElements = this.nodeRenderer.renderNodes(this.currentContent, root.descendants(), offsetX, offsetY);

		// Use TextRenderer to render text (batch process all nodes)
		this.textRenderer.renderText(nodeElements, undefined, this as unknown as { config?: MindMapConfig; editingState?: EditingState });

		// Attach interaction handlers
		this.attachInteractionHandlers(nodeElements as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>);
	}

	private setupZoom(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, container: Element): void {
		this.currentZoom = d3.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.filter((event: Event) => {
				// Check if canvas interaction is enabled (false in edit mode)
				if (!this.canvasInteractionEnabled) {
					return false;
				}

				// Check if event target is an editable element
				const target = event.target as HTMLElement;
				if (target.contentEditable === "true" || target.closest('[contenteditable="true"]')) {
					return false;
				}

				return true; // Allow normal zoom behavior
			})
			.on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
				this.handleZoom(event);
			});

		svg.call(this.currentZoom);

		// Remove D3 zoom double-click listener (prevent zoom when double-clicking nodes)
		svg.on("dblclick.zoom", null);
	}

	private applyInitialViewPosition(
		root: d3.HierarchyNode<MindMapNode>,
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
		zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
		container: Element
	): void {
		// Key fix: Only apply initial position on first render
		// If zoomTransform is already saved, this is not first render, should not reapply initial position
		if (this.currentZoomTransform) {
			return;
		}

		// Simplified initial position (can be optimized later)
		requestAnimationFrame(() => {
			const containerHeight = container.clientHeight || 1000;

			const initialTransform = d3.zoomIdentity
				.translate(20, (containerHeight - 100) / 2)
				.scale(1);

			svg.call((selection) => zoom.transform(selection, initialTransform));
		});
	}

	private attachInteractionHandlers(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>
	): void {
		// Use InteractionManager to attach handlers
		this.interactionManager.attachHandlers(this.currentSvg, nodeElements);

		// Mobile: create toolbar
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.create(this.currentSvg);
		}
	}

	// ========== Event Handling ==========

	private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void {
		// Update content group transform
		if (this.currentContent) {
			this.currentContent.attr('transform', event.transform.toString());
		}
		this.currentZoomTransform = event.transform;
	}

	// ========== RenderCallbacks Implementation ==========

	private handleNodeSelected(node: d3.HierarchyNode<MindMapNode>): void {
		this.selectedNode = node;

		// Render buttons
		const nodeElement = d3.selectAll('.nodes g').filter((d: d3.HierarchyNode<MindMapNode>) => d === node);
		const dimensions = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);

		this.buttonRenderer.renderPlusButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, node, dimensions);
		this.aiAssistant.renderAIButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, node, dimensions);

		// Mobile: show toolbar
		if (this.config.isMobile && this.mobileToolbar && !this.nodeEditor.isEditing()) {
			this.mobileToolbar.updatePosition(node, 0, 0);
		}
	}

	private handleNodeHovered(node: d3.HierarchyNode<MindMapNode>): void {
		this.hoveredNode = node;
	}

	private handleNodeLeft(node: d3.HierarchyNode<MindMapNode>): void {
		if (this.hoveredNode === node) {
			this.hoveredNode = null;
		}
	}

	private handleSelectionCleared(): void {
		this.selectedNode = null;

		// Mobile: hide toolbar
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.hide();
		}
	}

	private handleNodeDoubleClicked(node: d3.HierarchyNode<MindMapNode>, event: MouseEvent): void {
		// Delegate to NodeEditor
		const targetElement = d3.selectAll('.nodes g')
			.filter((d: d3.HierarchyNode<MindMapNode>) => d === node)
			.select('.node-unified-text')
			.node() as HTMLDivElement;

		if (targetElement) {
			this.nodeEditor.enableEditing(node, targetElement);
		}
	}

	private handleAddChildNode(node: d3.HierarchyNode<MindMapNode>): void {
		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		// Create new child node
		const newNode = this.mindMapService.createChildNode(node.data, 'New Node');

		// Clear all selection states
		this.clearSelection();

		// Set selected state directly in data layer
		// Note: Don't set selectedNode here, as it becomes stale after re-render
		// selectedNode will be properly updated in syncSelectedNodeReference() during render()
		newNode.selected = true;

		this.triggerDataUpdate();

		// Auto enter edit mode
		// Delayed execution to ensure DOM has updated
		setTimeout(() => {
			this.editNewNode();
		}, 150);
	}

	private handleAddSiblingNode(node: d3.HierarchyNode<MindMapNode>): void {
		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		// Create new sibling node
		const newNode = this.mindMapService.createSiblingNode(
			node.data,
			"New Node"
		);

		if (!newNode) return;

		// Clear all selection states
		this.clearSelection();

		// Select newly created sibling node in data layer
		// Note: Don't set selectedNode here, as it becomes stale after re-render
		// selectedNode will be properly updated in syncSelectedNodeReference() during render()
		newNode.selected = true;

		// Trigger data update and re-render
		this.triggerDataUpdate();

		// Auto enter edit mode
		setTimeout(() => {
			this.editNewNode();
		}, 150);
	}

	private handleDeleteNode(node: d3.HierarchyNode<MindMapNode>): void {
		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		const deleteSuccess = this.mindMapService.deleteNode(node.data);
		if (deleteSuccess) {
			this.clearSelection();
			this.triggerDataUpdate();
		}
	}

	private async handleCopyNode(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		await this.clipboardManager.copyNode(node);
	}

	private async handleCutNode(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		await this.clipboardManager.cutNode(node);
	}

	private async handlePasteToNode(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		// Save snapshot (before modification)
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		await this.clipboardManager.pasteToNode(node);
	}

	/**
	 * Handle exit edit mode
	 * Triggered by InteractionManager when clicking empty space
	 */
	private handleExitEditMode(): void {
		if (this.nodeEditor.isEditing()) {
			// NodeEditor.saveText() will:
			// 1. Validate text
			// 2. Update node.data.text
			// 3. Trigger onTextChanged callback (save file)
			// 4. Call exitEditMode() to clean up UI
			// 5. Trigger onCanvasInteractionChanged(true) callback
			this.nodeEditor.saveText();
		}
	}

	// ========== Helper Methods ==========

	private enterEditModeForNode(node: d3.HierarchyNode<MindMapNode>): void {
		const targetElement = d3.selectAll('.nodes g')
			.filter((d: d3.HierarchyNode<MindMapNode>) => d.data === node.data)
			.select('.node-unified-text')
			.node() as HTMLDivElement;

		if (targetElement) {
			this.nodeEditor.enableEditing(node, targetElement);
		}
	}

	private selectNode(node: d3.HierarchyNode<MindMapNode>): void {
		// Set selection state
		this.selectedNode = node;
		node.data.selected = true;

		// Add visual selection effect
		d3.selectAll('.node-rect')
			.filter((d: d3.HierarchyNode<MindMapNode>) => d === node)
			.classed('selected-rect', true);
	}

	private clearSelection(): void {
		// If editing, save edit content first
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.saveText();
			return;
		}

		// Recursively clear all data layer selection states
		if (this.currentData && this.currentData.rootNode) {
			this.clearAllSelectionStates(this.currentData.rootNode);
		}

		// Remove all visual effects
		d3.selectAll('.node-rect')
			.classed('selected-rect', false)
			.classed('hovered-rect', false);

		// Clear internal state
		this.selectedNode = null;
		this.hoveredNode = null;

		// Remove all buttons
		d3.selectAll('.plus-button-group').remove();
		d3.selectAll('.ai-suggest-button-group').remove();

		// Mobile: hide toolbar
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.hide();
		}
	}

	/**
	 * Recursively clear all node selection states
	 * Ensure data layer selection states are completely cleared
	 */
	private clearAllSelectionStates(node: MindMapNode): void {
		node.selected = false;
		node.hovered = false;

		for (const child of node.children) {
			this.clearAllSelectionStates(child);
		}
	}

	/**
	 * Validate selection state
	 * Check and fix abnormal situation where multiple nodes are selected
	 */
	private validateSelectionState(): void {
		if (!this.currentData || !this.currentData.rootNode) {
			return;
		}

		let selectedCount = 0;
		let firstSelected: MindMapNode | null = null;

		// Count selected nodes
		this.currentData.allNodes.forEach(node => {
			if (node.selected) {
				selectedCount++;
				if (!firstSelected) {
					firstSelected = node;
				}
			}
		});

		// If multiple nodes are selected, only keep the first one
		if (selectedCount > 1) {
			console.warn(`[Selection] Found ${selectedCount} selected nodes, clearing all except first`);

			this.currentData.allNodes.forEach(node => {
				if (node !== firstSelected && node.selected) {
					node.selected = false;
				}
			});
		}
	}

	// ========== Layout Calculation Methods ==========

	/**
	 * Calculate dynamic tree height
	 * Calculate required tree height based on node count and depth, avoid node overlap
	 */
	private calculateDynamicTreeHeight(root: d3.HierarchyNode<MindMapNode>): number {
		let maxDepth = 0;
		const nodesAtDepth: Record<number, d3.HierarchyNode<MindMapNode>[]> = {};

		// Count nodes and max depth at each level
		root.each(node => {
			maxDepth = Math.max(maxDepth, node.depth);
			if (!nodesAtDepth[node.depth]) {
				nodesAtDepth[node.depth] = [];
			}
			nodesAtDepth[node.depth].push(node);
		});

		// Calculate required height for each level, use optimized compact layout
		let totalHeight = 0;
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodes = nodesAtDepth[depth] || [];
			const layerHeight = this.calculateAdaptiveLayerHeight(nodes);

			// Fine-tuned depth spacing adjustment (fix layer 3 and 4 overlap)
			let depthMultiplier = 1.0;
			if (depth === 0) {
				depthMultiplier = 0.8; // Root node: more compact
			} else if (depth === 1) {
				depthMultiplier = 1.0; // Level 1: standard spacing
			} else if (depth === 2) {
				depthMultiplier = 1.3; // Level 2: moderate increase
			} else if (depth === 3) {
				depthMultiplier = 1.8; // Level 3: significant increase
			} else {
				depthMultiplier = 2.2 + (depth - 4) * 0.3; // Level 4+: large increase
			}

			const verticalSpacing = this.layoutConfig.verticalSpacing * depthMultiplier;

			// Intelligent adjustment based on node count (more conservative growth)
			const nodeCount = nodes.length;
			if (nodeCount > 3) {
				const nodeCountMultiplier = 1 + (nodeCount - 3) * 0.1; // Add 10% for each additional node
				totalHeight += layerHeight + (verticalSpacing * nodeCountMultiplier);
			} else {
				totalHeight += layerHeight + verticalSpacing;
			}
		}

		// Ensure not less than original height, add appropriate buffer
		const minHeight = Math.max(totalHeight, this.layoutConfig.treeHeight);
		const depthBuffer = Math.max(100, maxDepth * 25); // Use compact buffer

		return minHeight + depthBuffer;
	}

	/**
	 * Calculate adaptive layer height
	 * Calculate required height for a single layer of nodes
	 */
	private calculateAdaptiveLayerHeight(nodes: d3.HierarchyNode<MindMapNode>[]): number {
		if (nodes.length === 0) return 60;

		// Calculate max height of all nodes at this layer
		let maxHeight = 0;
		let totalTextLength = 0;

		nodes.forEach(node => {
			const dimensions = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);
			maxHeight = Math.max(maxHeight, dimensions.height);
			totalTextLength += node.data.text.length;
		});

		// Calculate layer height based on node height and text length
		const textLengthBonus = Math.min(totalTextLength / nodes.length * 2, 50); // 2px per character, max 50px bonus
		const adaptiveHeight = maxHeight + textLengthBonus;

		// Ensure minimum height
		const minHeight = nodes[0].depth === 0 ? 80 : nodes[0].depth === 1 ? 70 : 60;

		return Math.max(adaptiveHeight, minHeight);
	}

	// ========== State Management Methods ==========

	/**
	 * Create SVG gradient definitions
	 * Provide gradient color effects for links with visual depth
	 */
	private createGradientDefinitions(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		const defs = svg.append("defs");

		// Create main link gradient
		const linkGradient = defs.append("linearGradient")
			.attr("id", "linkGradient")
			.attr("x1", "0%")
			.attr("y1", "0%")
			.attr("x2", "100%")
			.attr("y2", "0%");

		linkGradient.append("stop")
			.attr("offset", "0%")
			.attr("stop-color", "var(--interactive-accent)")
			.attr("stop-opacity", 0.8);

		linkGradient.append("stop")
			.attr("offset", "50%")
			.attr("stop-color", "var(--interactive-accent-hover)")
			.attr("stop-opacity", 1);

		linkGradient.append("stop")
			.attr("offset", "100%")
			.attr("stop-color", "var(--text-accent)")
			.attr("stop-opacity", 0.6);
	}

	/**
	 * Sync selected node reference
	 * After re-render, update selectedNode reference to new D3 hierarchy
	 */
	private syncSelectedNodeReference(root: d3.HierarchyNode<MindMapNode>): void {
		let targetNode: MindMapNode | null = null;
		let foundNode: d3.HierarchyNode<MindMapNode> | null = null;

		// Strategy 1: If there's currently a selected node, try to sync its reference
		if (this.selectedNode && this.selectedNode.data) {
			targetNode = this.selectedNode.data;
		} else {
			// Strategy 2: If no selected node reference, find selected node from data layer
			// This handles the case after adding a new node (selectedNode is null, but new node's data.selected is true)
			root.each((d) => {
				if (d.data.selected && !targetNode) {
					targetNode = d.data;
				}
			});
		}

		// If no target node found, clear selection state
		if (!targetNode) {
			this.selectedNode = null;
			return;
		}

		// Use depth-first search to find node with same data reference
		root.each((d) => {
			if (d.data === targetNode) {
				foundNode = d;
			}
		});

		// If matching node found, update selectedNode reference
		if (foundNode) {
			this.selectedNode = foundNode;
		} else {
			// If not found (node may have been deleted), clear selection state
			this.selectedNode = null;
		}
	}

	/**
	 * Restore selection UI
	 * After re-render, restore buttons for selected nodes
	 */
	private restoreSelectionUI(): void {
		if (!this.currentSvg) return;

		// Iterate all nodes, restore buttons for selected nodes
		// Note: Nodes are <g> elements inside .nodes container, not .node class
		this.currentSvg.selectAll(".nodes g")
			.each((d: d3.HierarchyNode<MindMapNode>, i, nodes) => {
				if (d.data.selected) {
					const nodeElement = d3.select(nodes[i] as SVGGElement);
					const dimensions = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);

					// Call feature module methods
					this.buttonRenderer.renderPlusButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, d, dimensions);
					this.aiAssistant.renderAIButton(nodeElement as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>, d, dimensions);

					// Synchronize InteractionManager state with RendererCoordinator state
					// This ensures KeyboardManager gets the correct selected node
					this.interactionManager['state'].selectedNode = d;
				}
			});
	}

	/**
	 * Restore view state
	 * Restore previously saved zoom and pan state
	 */
	private restoreViewState(): void {
		if (this.currentZoomTransform && this.currentSvg && this.currentZoom) {
			// Check if current transform differs from saved transform, avoid duplicate application
			const svgNode = this.currentSvg.node();
			if (!svgNode) {
				return;
			}
			const currentTransform = d3.zoomTransform(svgNode);

			if (currentTransform.toString() !== this.currentZoomTransform.toString()) {
				// Apply previously saved zoom transform
				this.currentSvg
					.call((selection) => this.currentZoom.transform(selection, this.currentZoomTransform));

				// Also update content group transform
				if (this.currentContent) {
					// Convert ZoomTransform to string for transform attribute
					this.currentContent.attr("transform", this.currentZoomTransform.toString());
				}
			}
		}
	}

	/**
	 * Edit new node
	 * Automatically enter edit mode for newly created node
	 */
	private editNewNode(): void {
		// Use this.selectedNode directly, it has been synced to correct D3 reference in render()
		if (!this.selectedNode || !this.currentSvg) {
			return;
		}

		// Find DOM element through D3 node object comparison (not data object comparison)
		const nodeElements = d3.selectAll(".nodes g");
		const targetElement = nodeElements
			.filter((d: d3.HierarchyNode<MindMapNode>) => d === this.selectedNode)
			.select(".node-unified-text")
			.node() as HTMLDivElement;

		if (targetElement) {
			// Call NodeEditor method
			this.nodeEditor.enableEditing(this.selectedNode, targetElement);
		}
	}

	private triggerDataUpdate(): void {
		this.onDataUpdated?.();
	}

	// ========== Undo/Redo Public Methods ==========

	/**
	 * Undo last operation
	 * @returns true on success, false otherwise
	 */
	public undo(): boolean {

		if (!this.undoManager.canUndo()) {
			return false;
		}

		const previousData = this.undoManager.undo(this.currentData);

		if (previousData && this.currentData) {
			// Update current data
			this.currentData.rootNode = previousData.rootNode;
			this.currentData.allNodes = previousData.allNodes;
			this.currentData.maxLevel = previousData.maxLevel;


			// Clear selection state
			this.clearSelection();

			// Key fix: Notify view that data has been restored, need to sync update mindMapData
			this.onDataRestored?.(previousData);

			// Trigger data update (re-render and save file)
			this.triggerDataUpdate();
			return true;
		}

		return false;
	}

	/**
	 * Redo last undone operation
	 * @returns true on success, false otherwise
	 */
	public redo(): boolean {

		if (!this.undoManager.canRedo()) {
			return false;
		}

		const nextData = this.undoManager.redo(this.currentData);

		if (nextData && this.currentData) {
			// Update current data
			this.currentData.rootNode = nextData.rootNode;
			this.currentData.allNodes = nextData.allNodes;
			this.currentData.maxLevel = nextData.maxLevel;


			// Clear selection state
			this.clearSelection();

			// Key fix: Notify view that data has been restored, need to sync update mindMapData
			this.onDataRestored?.(nextData);

			// Trigger data update (re-render and save file)
			this.triggerDataUpdate();
			return true;
		}

		return false;
	}

	/**
	 * Check if undo is available
	 */
	public canUndo(): boolean {
		return this.undoManager.canUndo();
	}

	/**
	 * Check if redo is available
	 */
	public canRedo(): boolean {
		return this.undoManager.canRedo();
	}

	/**
	 * Clear history (called when loading new file)
	 */
	public clearHistory(): void {
		this.undoManager.clearHistory();
	}

	/**
	 * Get UndoManager instance (for external access, e.g., KeyboardManager)
	 */
	public getUndoManager(): UndoManager {
		return this.undoManager;
	}
}
