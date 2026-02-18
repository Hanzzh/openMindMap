/**
 * Renderer Coordinator - 主渲染协调器
 *
 * 【职责】
 * - 集成所有功能模块（交互、编辑、AI、剪贴板、按钮、工具栏）
 * - 协调渲染和交互
 * - 实现 MindMapRenderer 接口
 * - 管理生命周期
 *
 * 【设计原则】
 * - 组合优于继承：使用多个专门的模块而非单一巨型类
 * - 单一职责：每个模块负责特定功能
 * - 通过回调实现模块间通信
 * - 保持向后兼容：实现 MindMapRenderer 接口
 *
 * 【架构】
 * - 核心渲染：保留必要的 SVG 渲染逻辑
 * - 功能模块：使用 Phase 3 提取的 6 个模块
 * - 事件协调：通过 InteractionManager 统一管理
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapData, MindMapRenderer, EditingState, MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapConfig } from '../config/types';
import { MindMapMessages } from '../i18n';
import { UndoManager } from '../managers/UndoManager';

// 导入核心渲染器
import { TextMeasurer } from '../utils/TextMeasurer';
import { LayoutCalculator } from './layout-calculator';
import { NodeRenderer } from './core/NodeRenderer';
import { LinkRenderer } from './core/LinkRenderer';
import { TextRenderer } from './core/TextRenderer';

// 导入功能模块
import { InteractionManager, RenderCallbacks } from '../interactions/interaction-manager';
import { AIAssistant, AIAssistantCallbacks } from '../features/AIAssistant';
import { NodeEditor, NodeEditorCallbacks } from '../features/NodeEditor';
import { ClipboardManager, ClipboardManagerCallbacks } from '../features/ClipboardManager';
import { ButtonRenderer, ButtonRendererCallbacks } from '../features/ButtonRenderer';
import { MobileToolbar, MobileToolbarCallbacks } from '../features/MobileToolbar';

/**
 * Renderer Coordinator 类
 *
 * 替代 D3TreeRenderer，集成所有功能模块
 */
export class RendererCoordinator implements MindMapRenderer {
	// ========== 核心渲染组件 ==========
	private textMeasurer: TextMeasurer;
	private layoutCalculator: LayoutCalculator;
	private nodeRenderer: NodeRenderer;
	private linkRenderer: LinkRenderer;
	private textRenderer: TextRenderer;

	// ========== 功能模块 ==========
	private interactionManager: InteractionManager;
	private aiAssistant: AIAssistant;
	private nodeEditor: NodeEditor;
	private clipboardManager: ClipboardManager;
	private buttonRenderer: ButtonRenderer;
	private mobileToolbar: MobileToolbar;
	private undoManager: UndoManager;

	// ========== 状态管理 ==========
	private currentSvg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
	private currentContent: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
	private currentZoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
	private currentZoomTransform = d3.zoomIdentity;
	private currentData: MindMapData | null = null;

	// 视图状态
	private isRendering = false;
	private pendingRenderRequest = false;

	// 选中状态
	private selectedNode: d3.HierarchyNode<MindMapNode> | null = null;
	private hoveredNode: d3.HierarchyNode<MindMapNode> | null = null;

	// 编辑状态（共享给所有模块）
	private editingState: EditingState = {
		isEditing: false,
		currentNode: null,
		originalText: '',
		editElement: null
	};

	// 画布交互状态
	private canvasInteractionEnabled: boolean = true;

	// 布局配置系统
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

	// 配置和消息
	private config: MindMapConfig;
	private messages: MindMapMessages;

	// 回调
	onDataUpdated?: () => void;
	onTextChanged?: (node: d3.HierarchyNode<any>, newText: string) => void;
	onDataRestored?: (data: MindMapData) => void;

	constructor(
		private mindMapService: MindMapService,
		config?: MindMapConfig,
		messages?: MindMapMessages,
		private isActiveView?: () => boolean
	) {
		this.config = config || { isMobile: false } as MindMapConfig;
		this.messages = messages || {} as MindMapMessages;

		// 添加警告：如果 messages 为空，提示缺少国际化支持
		if (!messages) {
			// Messages will use default English fallback
		}

		// 初始化 UndoManager
		this.undoManager = new UndoManager();

		// 初始化核心渲染器
		this.initializeCoreRenderers();

		// 初始化功能模块
		this.initializeFeatureModules();
	}

	// ========== 初始化 ==========

	private initializeCoreRenderers(): void {
		this.textMeasurer = new TextMeasurer();
		this.layoutCalculator = new LayoutCalculator();
		this.nodeRenderer = new NodeRenderer(this.textMeasurer, this.layoutCalculator);
		this.linkRenderer = new LinkRenderer(this.textMeasurer, { lineOffset: this.layoutConfig.lineOffset });
		this.textRenderer = new TextRenderer(this.textMeasurer, this.config, this.editingState);
	}

	private initializeFeatureModules(): void {
		// 1. 交互管理器（协调其他所有模块）
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
				// 保存快照（在修改前）
				if (this.currentData) {
					this.undoManager.saveSnapshot(this.currentData);
				}
			},
			onTextChanged: (node, newText) => {
				this.onTextChanged?.(node, newText);
			},
			onCanvasInteractionChanged: (enabled) => {
				this.canvasInteractionEnabled = enabled;
				// 同步编辑状态到 InteractionManager
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

		// 6. Mobile Toolbar（仅移动端）
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

	// ========== MindMapRenderer 接口实现 ==========

	render(container: Element, data: MindMapData): void {
		// 渲染锁机制
		if (this.isRendering) {
			this.pendingRenderRequest = true;
			return;
		}
		this.isRendering = true;

		// 保存当前数据引用（用于 undo/redo）
		this.currentData = data;

		// 验证选中状态（在创建D3层次结构之前）
		this.validateSelectionState();

		// 在 try 块外声明，以便 finally 块可以访问
		let root: d3.HierarchyNode<any>;

		try {
			// 清空容器 - 使用 D3 方法而不是 innerHTML，保留对象引用
			d3.select(container).selectAll('*').remove();

			// 创建 SVG
			const svg = d3.select(container).append('svg')
				.attr('width', '100%')
				.attr('height', '100%')
				.style('position', 'relative');

			this.currentSvg = svg;

			// 创建内容组
			this.currentContent = svg.append('g')
				.attr('class', 'mindmap-content');

			// 计算布局 - 创建D3层次结构
			root = d3.hierarchy(data.rootNode);

			// 计算动态树高度
			const dynamicTreeHeight = this.calculateDynamicTreeHeight(root);

			// 更新 LayoutCalculator 的配置
			this.layoutCalculator.updateConfig({
				treeHeight: dynamicTreeHeight
			});

			// 应用自定义树形布局
			this.layoutCalculator.createCustomTreeLayout(root, (depth, text) =>
				this.textMeasurer.getNodeDimensions(depth, text)
			);

			// 创建 SVG 渐变定义
			this.createGradientDefinitions(svg);

			// 设置缩放 - 在渲染节点之前设置（参照重构前的实现）
			this.setupZoom(svg, container);

			// 立即应用已保存的 zoom 状态（防止视觉跳跃）
			if (this.currentZoomTransform) {
				svg.call(this.currentZoom.transform, this.currentZoomTransform);
				this.currentContent.attr("transform", this.currentZoomTransform as any);
			}

			// 偏移量（居中偏移，暂时使用0）
			const offsetX = 0;
			const offsetY = 0;

			// 渲染连线
			this.renderLinks(root, offsetX, offsetY);

			// 渲染节点
			this.renderNodes(root, offsetX, offsetY);

			// 恢复视图状态
			this.restoreViewState();

			// 应用初始视图位置
			this.applyInitialViewPosition(root, svg, this.currentZoom, container);

		} finally {
			this.isRendering = false;

			// 处理待处理的渲染请求
			if (this.pendingRenderRequest) {
				this.pendingRenderRequest = false;
				setTimeout(() => {
					this.render(container, data);
				}, 16); // 约一帧的时间
			}

			// 同步节点引用
			this.syncSelectedNodeReference(root);

			// 🔧 移动端：重新创建工具栏（确保工具栏始终存在且唯一）
			if (this.config.isMobile && this.mobileToolbar) {
				this.mobileToolbar.create(this.currentSvg);
			}

			// 恢复 UI 状态（如果有选中节点，会显示工具栏）
			this.restoreSelectionUI();
		}
	}

	destroy(): void {
		// 销毁所有模块
		this.mobileToolbar?.destroy();
		this.buttonRenderer.destroy();
		this.clipboardManager.destroy();
		this.nodeEditor.destroy();
		this.aiAssistant.destroy();
		this.interactionManager.destroy();

		// 清理 SVG
		if (this.currentSvg) {
			this.currentSvg.selectAll('*').remove();
			this.currentSvg = null;
		}
		this.currentContent = null;
	}

	// ========== 公共方法（兼容性接口）==========

	/**
	 * 保存当前视图状态
	 * 注意：此方法保留用于兼容性，实际上视图状态在 render() 中自动保存
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
	 * 退出编辑模式
	 * 注意：此方法保留用于兼容性，实际上编辑状态由 NodeEditor 管理
	 */
	public exitEditMode(): void {
		// Edit state is automatically managed by NodeEditor
		// This method is kept for backward compatibility
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.exitEditMode();
		}
	}

	/**
	 * 保存节点文本
	 * 供 TextRenderer 的键盘事件处理器调用
	 * 在编辑模式下按 Enter 键时触发
	 */
	public saveNodeText(): void {
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.saveText();
		}
		// else: Not in editing mode, nothing to save
	}

	/**
	 * 取消编辑模式
	 * 供 TextRenderer 的键盘事件处理器调用
	 * 在编辑模式下按 Escape 键时触发
	 */
	public cancelEditMode(): void {
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.cancelEdit();
		}
	}

	// ========== 私有渲染方法 ==========

	private renderLinks(root: d3.HierarchyNode<any>, offsetX: number, offsetY: number): void {
		// 使用 LinkRenderer 渲染连线
		this.linkRenderer.renderLinks(this.currentContent, root.links(), offsetX, offsetY);
	}

	private renderNodes(root: d3.HierarchyNode<MindMapNode>, offsetX: number, offsetY: number): void {
		// 使用 NodeRenderer 渲染节点矩形
		const nodeElements = this.nodeRenderer.renderNodes(this.currentContent, root.descendants(), offsetX, offsetY);

		// 使用 TextRenderer 渲染文本（批量处理所有节点）
		this.textRenderer.renderText(nodeElements, undefined, this as unknown as { config?: MindMapConfig; editingState?: EditingState });

		// 附加交互处理器
		this.attachInteractionHandlers(nodeElements as d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>);
	}

	private setupZoom(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, container: Element): void {
		this.currentZoom = d3.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.filter((event: Event) => {
				// 检查画布交互是否启用（编辑模式下为 false）
				if (!this.canvasInteractionEnabled) {
					return false;
				}

				// 检查事件目标是否为可编辑元素
				const target = event.target as HTMLElement;
				if (target.contentEditable === "true" || target.closest('[contenteditable="true"]')) {
					return false;
				}

				return true; // 允许正常的缩放行为
			})
			.on('zoom', (event) => {
				this.handleZoom(event);
			});

		svg.call(this.currentZoom);

		// 移除 D3 zoom 的双击缩放监听器（防止双击节点时触发缩放）
		svg.on("dblclick.zoom", null);
	}

	private applyInitialViewPosition(
		root: d3.HierarchyNode<any>,
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
		zoom: d3.ZoomBehavior<any, unknown>,
		container: Element
	): void {
		// 🔑 关键修复：只在首次渲染时应用初始位置
		// 如果已经有保存的 zoomTransform，说明不是首次渲染，不应该重新应用初始位置
		if (this.currentZoomTransform) {
			return;
		}

		// 简化版初始位置（可以后续优化）
		requestAnimationFrame(() => {
			const containerWidth = container.clientWidth || 1600;
			const containerHeight = container.clientHeight || 1000;

			const initialTransform = d3.zoomIdentity
				.translate(20, (containerHeight - 100) / 2)
				.scale(1);

			svg.call(zoom.transform, initialTransform);
		});
	}

	private attachInteractionHandlers(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>
	): void {
		// 使用 InteractionManager 附加处理器
		this.interactionManager.attachHandlers(this.currentSvg, nodeElements);

		// 移动端：创建工具栏
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.create(this.currentSvg);
		}
	}

	// ========== 事件处理 ==========

	private handleZoom(event: any): void {
		// 更新内容组变换
		if (this.currentContent) {
			this.currentContent.attr('transform', event.transform);
		}
		this.currentZoomTransform = event.transform;
	}

	// ========== RenderCallbacks 实现 ==========

	private handleNodeSelected(node: d3.HierarchyNode<any>): void {
		this.selectedNode = node;

		// 渲染按钮
		const nodeElement = d3.selectAll('.nodes g').filter((d: any) => d === node);
		const dimensions = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);

		this.buttonRenderer.renderPlusButton(nodeElement as any, node, dimensions);
		this.aiAssistant.renderAIButton(nodeElement as any, node, dimensions);

		// 移动端：显示工具栏
		if (this.config.isMobile && this.mobileToolbar && !this.nodeEditor.isEditing()) {
			this.mobileToolbar.updatePosition(node, 0, 0);
		}
	}

	private handleNodeHovered(node: d3.HierarchyNode<any>): void {
		this.hoveredNode = node;
	}

	private handleNodeLeft(node: d3.HierarchyNode<any>): void {
		if (this.hoveredNode === node) {
			this.hoveredNode = null;
		}
	}

	private handleSelectionCleared(): void {
		this.selectedNode = null;

		// 移动端：隐藏工具栏
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.hide();
		}
	}

	private handleNodeDoubleClicked(node: d3.HierarchyNode<any>, event: MouseEvent): void {
		// 委托给 NodeEditor 处理
		const targetElement = d3.selectAll('.nodes g')
			.filter((d: any) => d === node)
			.select('.node-unified-text')
			.node() as HTMLDivElement;

		if (targetElement) {
			this.nodeEditor.enableEditing(node, targetElement);
		}
	}

	private handleAddChildNode(node: d3.HierarchyNode<any>): void {
		// 保存快照（在修改前）
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		// 创建新的子节点
		const newNode = this.mindMapService.createChildNode(node.data, 'New Node');

		// 清除所有选中状态
		this.clearSelection();

		// 直接在数据层设置选中状态（不调用selectNode()）
		newNode.selected = true;

		// 更新内部引用
		this.selectedNode = {
			data: newNode,
			depth: newNode.level,
			parent: node,
			children: []
		} as d3.HierarchyNode<any>;

		this.triggerDataUpdate();

		// 自动进入编辑模式
		setTimeout(() => {
			this.editNewNode();
		}, 150);
	}

	private handleAddSiblingNode(node: d3.HierarchyNode<any>): void {
		// 保存快照（在修改前）
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		// 1. 保存父节点引用（在清除选中状态之前）
		const parentNode = node.parent;

		// 2. 创建新的兄弟节点
		const newNode = this.mindMapService.createSiblingNode(
			node.data,
			"New Node"
		);

		if (!newNode) return;

		// 3. 清除所有选中状态
		this.clearSelection();

		// 4. 选中新创建的兄弟节点
		newNode.selected = true;
		this.selectedNode = {
			data: newNode,
			depth: newNode.level,
			parent: parentNode,
			children: []
		} as d3.HierarchyNode<any>;

		// 5. 触发数据更新和重新渲染
		this.triggerDataUpdate();

		// 6. 自动进入编辑模式
		setTimeout(() => {
			this.editNewNode();
		}, 150);
	}

	private handleDeleteNode(node: d3.HierarchyNode<any>): void {
		// 保存快照（在修改前）
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		const deleteSuccess = this.mindMapService.deleteNode(node.data);
		if (deleteSuccess) {
			this.clearSelection();
			this.triggerDataUpdate();
		}
	}

	private async handleCopyNode(node: d3.HierarchyNode<any>): Promise<void> {
		await this.clipboardManager.copyNode(node);
	}

	private async handleCutNode(node: d3.HierarchyNode<any>): Promise<void> {
		// 保存快照（在修改前）
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		await this.clipboardManager.cutNode(node);
	}

	private async handlePasteToNode(node: d3.HierarchyNode<any>): Promise<void> {
		// 保存快照（在修改前）
		if (this.currentData) {
			this.undoManager.saveSnapshot(this.currentData);
		}

		await this.clipboardManager.pasteToNode(node);
	}

	/**
	 * 处理退出编辑模式
	 * 由 InteractionManager 在点击空白处时触发
	 */
	private handleExitEditMode(): void {
		if (this.nodeEditor.isEditing()) {
			// NodeEditor.saveText() 会：
			// 1. 验证文本
			// 2. 更新 node.data.text
			// 3. 触发 onTextChanged 回调（保存文件）
			// 4. 调用 exitEditMode() 清理UI
			// 5. 触发 onCanvasInteractionChanged(true) 回调
			this.nodeEditor.saveText();
		}
	}

	// ========== 辅助方法 ==========

	private enterEditModeForNode(node: d3.HierarchyNode<any>): void {
		const targetElement = d3.selectAll('.nodes g')
			.filter((d: any) => d.data === node.data)
			.select('.node-unified-text')
			.node() as HTMLDivElement;

		if (targetElement) {
			this.nodeEditor.enableEditing(node, targetElement);
		}
	}

	private selectNode(node: d3.HierarchyNode<any>): void {
		// 设置选中状态
		this.selectedNode = node;
		node.data.selected = true;

		// 添加选中视觉效果
		d3.selectAll('.node-rect')
			.filter((d: any) => d === node)
			.classed('selected-rect', true);
	}

	private clearSelection(): void {
		// 如果正在编辑，先保存编辑内容
		if (this.nodeEditor.isEditing()) {
			this.nodeEditor.saveText();
			return;
		}

		// 递归清除所有数据层选中状态
		if (this.currentData && this.currentData.rootNode) {
			this.clearAllSelectionStates(this.currentData.rootNode);
		}

		// 移除所有视觉效果
		d3.selectAll('.node-rect')
			.classed('selected-rect', false)
			.classed('hovered-rect', false);

		// 清除内部状态
		this.selectedNode = null;
		this.hoveredNode = null;

		// 移除所有按钮
		d3.selectAll('.plus-button-group').remove();
		d3.selectAll('.ai-suggest-button-group').remove();

		// 移动端：隐藏工具栏
		if (this.config.isMobile && this.mobileToolbar) {
			this.mobileToolbar.hide();
		}
	}

	/**
	 * 递归清除所有节点选中状态
	 * 确保数据层选中状态被完全清除
	 */
	private clearAllSelectionStates(node: MindMapNode): void {
		node.selected = false;
		node.hovered = false;

		for (const child of node.children) {
			this.clearAllSelectionStates(child);
		}
	}

	/**
	 * 验证选中状态
	 * 检查并修复多个节点被选中的异常情况
	 */
	private validateSelectionState(): void {
		if (!this.currentData || !this.currentData.rootNode) {
			return;
		}

		let selectedCount = 0;
		let firstSelected: MindMapNode | null = null;

		// 统计选中节点
		this.currentData.allNodes.forEach(node => {
			if (node.selected) {
				selectedCount++;
				if (!firstSelected) {
					firstSelected = node;
				}
			}
		});

		// 如果发现多个节点被选中，只保留第一个
		if (selectedCount > 1) {
			console.warn(`[Selection] Found ${selectedCount} selected nodes, clearing all except first`);

			this.currentData.allNodes.forEach(node => {
				if (node !== firstSelected && node.selected) {
					node.selected = false;
				}
			});
		}
	}

	// ========== 布局计算方法 ==========

	/**
	 * 计算动态树高度
	 * 基于节点数量和深度计算所需的树高度，避免节点重叠
	 */
	private calculateDynamicTreeHeight(root: d3.HierarchyNode<any>): number {
		let maxDepth = 0;
		let nodesAtDepth: { [key: number]: d3.HierarchyNode<any>[] } = {};

		// 统计每层的节点和最大深度
		root.each(node => {
			maxDepth = Math.max(maxDepth, node.depth);
			if (!nodesAtDepth[node.depth]) {
				nodesAtDepth[node.depth] = [];
			}
			nodesAtDepth[node.depth].push(node);
		});

		// 计算每层所需的高度，使用优化的紧凑布局
		let totalHeight = 0;
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nodes = nodesAtDepth[depth] || [];
			const layerHeight = this.calculateAdaptiveLayerHeight(nodes);

			// 精细化深度间距调整（同步修复第三层和第四层重叠）
			let depthMultiplier = 1.0;
			if (depth === 0) {
				depthMultiplier = 0.8; // 根节点：更紧凑
			} else if (depth === 1) {
				depthMultiplier = 1.0; // 第1层：标准间距
			} else if (depth === 2) {
				depthMultiplier = 1.3; // 第2层：适度增加
			} else if (depth === 3) {
				depthMultiplier = 1.8; // 第3层：显著增加
			} else {
				depthMultiplier = 2.2 + (depth - 4) * 0.3; // 第4层+：大幅增加
			}

			const verticalSpacing = this.layoutConfig.verticalSpacing * depthMultiplier;

			// 基于节点数量的智能调整（更保守的增长）
			const nodeCount = nodes.length;
			if (nodeCount > 3) {
				const nodeCountMultiplier = 1 + (nodeCount - 3) * 0.1; // 每多一个节点增加10%
				totalHeight += layerHeight + (verticalSpacing * nodeCountMultiplier);
			} else {
				totalHeight += layerHeight + verticalSpacing;
			}
		}

		// 确保不小于原高度，并添加适当的缓冲空间
		const minHeight = Math.max(totalHeight, this.layoutConfig.treeHeight);
		const depthBuffer = Math.max(100, maxDepth * 25); // 使用紧凑的缓冲

		return minHeight + depthBuffer;
	}

	/**
	 * 计算自适应层高
	 * 计算单层节点所需的高度
	 */
	private calculateAdaptiveLayerHeight(nodes: d3.HierarchyNode<any>[]): number {
		if (nodes.length === 0) return 60;

		// 计算该层所有节点的最大高度
		let maxHeight = 0;
		let totalTextLength = 0;

		nodes.forEach(node => {
			const dimensions = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);
			maxHeight = Math.max(maxHeight, dimensions.height);
			totalTextLength += node.data.text.length;
		});

		// 基于节点高度和文本长度计算层高
		const textLengthBonus = Math.min(totalTextLength / nodes.length * 2, 50); // 每个字符2px，最多50px奖励
		const adaptiveHeight = maxHeight + textLengthBonus;

		// 确保最小高度
		const minHeight = nodes[0].depth === 0 ? 80 : nodes[0].depth === 1 ? 70 : 60;

		return Math.max(adaptiveHeight, minHeight);
	}

	// ========== 状态管理方法 ==========

	/**
	 * 创建 SVG 渐变定义
	 * 为连线提供视觉层次感的渐变色效果
	 */
	private createGradientDefinitions(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		const defs = svg.append("defs");

		// 创建主要连线渐变
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
	 * 同步选中节点引用
	 * 重新渲染后，将 selectedNode 引用更新到新的 D3 层级结构
	 */
	private syncSelectedNodeReference(root: d3.HierarchyNode<any>): void {
		// 如果当前没有选中的节点，直接返回
		if (!this.selectedNode || !this.selectedNode.data) {
			return;
		}

		// 遍历新的D3层级结构，找到匹配的节点
		const targetNode = this.selectedNode.data;
		let foundNode: d3.HierarchyNode<any> | null = null;

		// 使用深度优先搜索找到具有相同数据引用的节点
		root.each((d) => {
			if (d.data === targetNode) {
				foundNode = d;
			}
		});

		// 如果找到了匹配的节点，更新selectedNode引用
		if (foundNode) {
			this.selectedNode = foundNode;
		} else {
			// 如果没找到（节点可能被删除），清除选中状态
			this.selectedNode = null;
		}
	}

	/**
	 * 恢复选中 UI
	 * 重新渲染后，为选中节点恢复按钮
	 */
	private restoreSelectionUI(): void {
		if (!this.currentSvg) return;

		// 遍历所有节点，为选中节点恢复按钮
		this.currentSvg.selectAll(".node")
			.each((d: any, i, nodes) => {
				if (d.data.selected) {
					const nodeElement = d3.select(nodes[i] as SVGGElement);
					const dimensions = this.textMeasurer.getNodeDimensions(d.depth, d.data.text);

					// 调用功能模块的方法
					this.buttonRenderer.renderPlusButton(nodeElement as any, d, dimensions);
					this.aiAssistant.renderAIButton(nodeElement as any, d, dimensions);
				}
			});
	}

	/**
	 * 恢复视图状态
	 * 恢复之前保存的缩放和平移状态
	 */
	private restoreViewState(): void {
		if (this.currentZoomTransform && this.currentSvg && this.currentZoom) {
			// 检查当前变换是否与保存的变换不同，避免重复应用
			const svgNode = this.currentSvg.node();
			if (!svgNode) {
				return;
			}
			const currentTransform = d3.zoomTransform(svgNode);

			if (currentTransform.toString() !== this.currentZoomTransform.toString()) {
				// 应用之前保存的缩放变换
				this.currentSvg
					.call(this.currentZoom.transform, this.currentZoomTransform);

				// 同时更新内容组的变换
				if (this.currentContent) {
					// Type assertion: D3 accepts ZoomTransform for attr("transform", ...)
					this.currentContent.attr("transform", this.currentZoomTransform as any);
				}
			}
		}
	}

	/**
	 * 编辑新节点
	 * 自动进入新创建节点的编辑模式
	 */
	private editNewNode(): void {
		// 直接使用 this.selectedNode,它已经在 render 中被同步到正确的D3引用
		if (!this.selectedNode || !this.currentSvg) {
			return;
		}

		// 通过D3节点对象比较(而非数据对象比较)找到DOM元素
		const nodeElements = d3.selectAll(".nodes g");
		const targetElement = nodeElements
			.filter((d: any) => d === this.selectedNode)
			.select(".node-unified-text")
			.node() as HTMLDivElement;

		if (targetElement) {
			// 调用 NodeEditor 的方法
			this.nodeEditor.enableEditing(this.selectedNode, targetElement);
		}
	}

	private triggerDataUpdate(): void {
		this.onDataUpdated?.();
	}

	// ========== Undo/Redo 公共方法 ==========

	/**
	 * 撤销上一次操作
	 * @returns 成功返回 true，否则返回 false
	 */
	public undo(): boolean {

		if (!this.undoManager.canUndo()) {
			return false;
		}

		const previousData = this.undoManager.undo(this.currentData);

		if (previousData && this.currentData) {
			// 更新当前数据
			this.currentData.rootNode = previousData.rootNode;
			this.currentData.allNodes = previousData.allNodes;
			this.currentData.maxLevel = previousData.maxLevel;


			// 清除选中状态
			this.clearSelection();

			// ✅ 关键修复：通知视图数据已恢复，需要同步更新 mindMapData
			this.onDataRestored?.(previousData);

			// 触发数据更新（重新渲染和保存文件）
			this.triggerDataUpdate();
			return true;
		}

		return false;
	}

	/**
	 * 重做上一次撤销的操作
	 * @returns 成功返回 true，否则返回 false
	 */
	public redo(): boolean {

		if (!this.undoManager.canRedo()) {
			return false;
		}

		const nextData = this.undoManager.redo(this.currentData);

		if (nextData && this.currentData) {
			// 更新当前数据
			this.currentData.rootNode = nextData.rootNode;
			this.currentData.allNodes = nextData.allNodes;
			this.currentData.maxLevel = nextData.maxLevel;


			// 清除选中状态
			this.clearSelection();

			// ✅ 关键修复：通知视图数据已恢复，需要同步更新 mindMapData
			this.onDataRestored?.(nextData);

			// 触发数据更新（重新渲染和保存文件）
			this.triggerDataUpdate();
			return true;
		}

		return false;
	}

	/**
	 * 检查是否可以撤销
	 */
	public canUndo(): boolean {
		return this.undoManager.canUndo();
	}

	/**
	 * 检查是否可以重做
	 */
	public canRedo(): boolean {
		return this.undoManager.canRedo();
	}

	/**
	 * 清空历史记录（加载新文件时调用）
	 */
	public clearHistory(): void {
		this.undoManager.clearHistory();
	}

	/**
	 * 获取 UndoManager 实例（供外部访问，如 KeyboardManager）
	 */
	public getUndoManager(): UndoManager {
		return this.undoManager;
	}
}
