/**
 * Interaction Manager
 *
 * Manages interaction handling based on device type
 * Implements early branching pattern to ensure desktop interactions are not affected
 *
 * 【重构说明】
 * 根据 D3TreeRenderer-REFACTORING-PLAN.md Phase 2.3 重构
 * 从原来的 DesktopInteraction/MobileInteraction 包装模式
 * 改为 MouseInteraction + KeyboardManager 协调模式
 *
 * 【职责】
 * - 协调 MouseInteraction 和 KeyboardManager
 * - 管理交互状态（selectedNode, hoveredNode, editingState）
 * - 提供统一的交互 API
 * - 处理交互与渲染的桥接
 */

import * as d3 from 'd3';
import { MindMapConfig } from '../config/types';
import { MindMapNode, EditingState } from '../interfaces/mindmap-interfaces';
import { MouseInteraction } from './MouseInteraction';
import { KeyboardManager } from './KeyboardManager';
import { MouseInteractionCallbacks } from './MouseInteractionCallbacks';
import { KeyboardHandlers, KeyboardManagerConfig } from './KeyboardManagerCallbacks';

/**
 * 交互状态接口
 */
export interface InteractionState {
	selectedNode: d3.HierarchyNode<MindMapNode> | null;
	hoveredNode: d3.HierarchyNode<MindMapNode> | null;
	editingState: EditingState;
}

/**
 * 渲染回调接口（桥接交互和渲染）
 */
export interface RenderCallbacks {
	onNodeSelected?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onNodeHovered?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onNodeLeft?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onSelectionCleared?: () => void;
	onNodeDoubleClicked?: (node: d3.HierarchyNode<MindMapNode>, event: MouseEvent) => void;
	onAddChildNode?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onAddSiblingNode?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onDeleteNode?: (node: d3.HierarchyNode<MindMapNode>) => void;
	onCopyNode?: (node: d3.HierarchyNode<MindMapNode>) => Promise<void>;
	onCutNode?: (node: d3.HierarchyNode<MindMapNode>) => Promise<void>;
	onPasteToNode?: (node: d3.HierarchyNode<MindMapNode>) => Promise<void>;
	onExitEditMode?: () => void;
	onUndo?: () => void;
	onRedo?: () => void;
}

/**
 * Interaction manager class
 *
 * Architecture Note:
 * This class implements the early branching pattern where device detection
 * happens once at initialization time based on config.isMobile.
 *
 * After refactoring (Phase 2.3):
 * - Coordinates MouseInteraction and KeyboardManager
 * - Manages interaction state centrally
 * - Provides unified API for interaction operations
 * - Bridges interaction events with rendering callbacks
 */
export class InteractionManager {
	private mouseInteraction: MouseInteraction;
	private keyboardManager: KeyboardManager;

	// 交互状态
	private state: InteractionState = {
		selectedNode: null,
		hoveredNode: null,
		editingState: {
			isEditing: false,
			currentNode: null,
			originalText: '',
			editElement: null
		}
	};

	constructor(
		private config: MindMapConfig,
		private renderCallbacks: RenderCallbacks = {},
		private isActiveView?: () => boolean
	) {
		// 🔒 EARLY BRANCHING: Device-specific interaction handler selection
		// This is the only place where we check device type for interactions
		// After this point, the handler is fixed and never changes

		// 初始化鼠标交互模块
		const mouseCallbacks: MouseInteractionCallbacks = {
			onNodeSelect: this.handleNodeSelect.bind(this),
			onNodeDoubleClick: this.handleNodeDoubleClick.bind(this),
			onNodeHover: this.handleNodeHover.bind(this),
			onNodeLeave: this.handleNodeLeave.bind(this),
			onCanvasClick: this.handleCanvasClick.bind(this),
			onCanvasDrag: this.handleCanvasDrag.bind(this),
			isCanvasInteractionEnabled: this.isCanvasInteractionEnabled.bind(this),
			isEditing: () => this.state.editingState.isEditing,
			getEditingNode: () => this.state.editingState.currentNode
		};
		this.mouseInteraction = new MouseInteraction(mouseCallbacks);

		// 初始化键盘管理器
		const keyboardConfig: KeyboardManagerConfig = {
			config: this.config,
			isEditing: () => this.state.editingState.isEditing,
			getSelectedNode: () => this.state.selectedNode,
			isActiveView: this.isActiveView
		};

		const keyboardHandlers: KeyboardHandlers = {
			onTab: this.handleTabKey.bind(this),
			onDelete: this.handleDeleteKey.bind(this),
			onEnter: this.handleEnterKey.bind(this),
			onCopy: this.handleCopyShortcut.bind(this),
			onCut: this.handleCutShortcut.bind(this),
			onPaste: this.handlePasteShortcut.bind(this),
			onUndo: this.handleUndoShortcut.bind(this),
			onRedo: this.handleRedoShortcut.bind(this)
		};
		this.keyboardManager = new KeyboardManager(keyboardConfig, keyboardHandlers);
	}

	/**
	 * 附加所有交互处理器
	 *
	 * @param svg SVG 元素选择集
	 * @param nodeElements 节点元素选择集
	 */
	attachHandlers(
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		// 鼠标交互
		this.mouseInteraction.attachNodeClickHandlers(nodeElements);
		this.mouseInteraction.attachNodeHoverHandlers(nodeElements);
		this.mouseInteraction.attachCanvasDragHandlers(svg);
		this.mouseInteraction.attachCanvasClickHandler(svg);

		// 键盘交互
		this.keyboardManager.attachGlobalListener();
	}

	/**
	 * 获取交互处理器实例（向后兼容）
	 * @deprecated 使用 getMouseInteraction() 或 getKeyboardManager() 代替
	 */
	getHandler(): {
		mouseInteraction: MouseInteraction;
		keyboardManager: KeyboardManager;
	} {
		return {
			mouseInteraction: this.mouseInteraction,
			keyboardManager: this.keyboardManager
		};
	}

	/**
	 * 获取鼠标交互处理器
	 */
	getMouseInteraction(): MouseInteraction {
		return this.mouseInteraction;
	}

	/**
	 * 获取键盘管理器
	 */
	getKeyboardManager(): KeyboardManager {
		return this.keyboardManager;
	}

	/**
	 * 获取设备类型
	 * @returns true if mobile interaction handler is active, false if desktop
	 */
	isMobile(): boolean {
		return this.config.isMobile;
	}

	/**
	 * 获取当前交互状态
	 */
	getState(): InteractionState {
		return { ...this.state };
	}

	/**
	 * 选中节点
	 */
	selectNode(node: d3.HierarchyNode<MindMapNode>): void {
		this.state.selectedNode = node;
		this.renderCallbacks.onNodeSelected?.(node);
	}

	/**
	 * 悬停节点
	 */
	hoverNode(node: d3.HierarchyNode<MindMapNode>): void {
		this.state.hoveredNode = node;
		this.renderCallbacks.onNodeHovered?.(node);
	}

	/**
	 * 清除所有选择
	 */
	clearSelection(): void {
		this.state.selectedNode = null;
		this.mouseInteraction.clearSelection();
		this.renderCallbacks.onSelectionCleared?.();
	}

	/**
	 * 进入编辑模式
	 */
	enterEditing(node: d3.HierarchyNode<MindMapNode>, element: HTMLDivElement): void {
		this.state.editingState = {
			isEditing: true,
			currentNode: node,
			originalText: node.data.text,
			editElement: element
		};
		// Note: Actual editing logic is handled by NodeEditor
		// This just updates the state
	}

	/**
	 * 退出编辑模式
	 */
	exitEditing(): void {
		this.state.editingState = {
			isEditing: false,
			currentNode: null,
			originalText: '',
			editElement: null
		};
	}

	/**
	 * 检查画布交互是否启用
	 */
	isCanvasInteractionEnabled(): boolean {
		// 编辑模式下禁用画布交互
		return !this.state.editingState.isEditing;
	}

	/**
	 * 销毁
	 */
	destroy(): void {
		this.keyboardManager.destroy();
		this.mouseInteraction.destroy();

		// 清理状态
		this.state.selectedNode = null;
		this.state.hoveredNode = null;
		this.state.editingState = {
			isEditing: false,
			currentNode: null,
			originalText: '',
			editElement: null
		};
	}

	/**
	 * 同步编辑状态
	 * 由 NodeEditor 调用，同步编辑模式状态到 InteractionManager
	 *
	 * 注意：RendererCoordinator 通过共享 editingState 管理真实状态
	 * InteractionManager 只需要知道是否正在编辑，用于交互判断
	 *
	 * @param isEditing 是否处于编辑模式
	 */
	syncEditingState(isEditing: boolean): void {
		// 简化：只同步 isEditing 标志
		// 完整的编辑状态由 RendererCoordinator.editingState 管理
		this.state.editingState.isEditing = isEditing;

		// 如果退出编辑模式，清除本地引用（保持一致性）
		if (!isEditing) {
			this.state.editingState.currentNode = null;
			this.state.editingState.originalText = '';
			this.state.editingState.editElement = null;
		}
	}

	// ========== 私有事件处理器 ==========

	/**
	 * 处理节点选择事件
	 */
	private handleNodeSelect(node: d3.HierarchyNode<MindMapNode>): void {
		this.selectNode(node);
	}

	/**
	 * 处理节点双击事件
	 */
	private handleNodeDoubleClick(node: d3.HierarchyNode<MindMapNode>, event: MouseEvent): void {
		this.renderCallbacks.onNodeDoubleClicked?.(node, event);
	}

	/**
	 * 处理节点悬停事件
	 */
	private handleNodeHover(node: d3.HierarchyNode<MindMapNode>): void {
		this.hoverNode(node);
	}

	/**
	 * 处理节点离开事件
	 */
	private handleNodeLeave(node: d3.HierarchyNode<MindMapNode>): void {
		this.state.hoveredNode = null;
		this.renderCallbacks.onNodeLeft?.(node);
	}

	/**
	 * 处理画布点击事件
	 */
	private handleCanvasClick(): void {

		// 如果当前正在编辑，先退出编辑模式
		if (this.state.editingState.isEditing) {
			this.renderCallbacks.onExitEditMode?.();
			return;
		}
		this.clearSelection();
	}

	/**
	 * 处理画布拖拽事件
	 */
	private handleCanvasDrag(dx: number, dy: number): void {
		// Note: Canvas drag handling is typically done by D3 zoom behavior
		// This callback is for custom drag handling if needed
	}

	/**
	 * 处理 Tab 键事件
	 */
	private handleTabKey(node: d3.HierarchyNode<MindMapNode>): void {
		this.renderCallbacks.onAddChildNode?.(node);
	}

	/**
	 * 处理 Delete 键事件
	 */
	private handleDeleteKey(node: d3.HierarchyNode<MindMapNode>): void {
		this.renderCallbacks.onDeleteNode?.(node);
	}

	/**
	 * 处理 Enter 键事件
	 */
	private handleEnterKey(node: d3.HierarchyNode<MindMapNode>): void {
		this.renderCallbacks.onAddSiblingNode?.(node);
	}

	/**
	 * 处理复制快捷键
	 */
	private async handleCopyShortcut(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		await this.renderCallbacks.onCopyNode?.(node);
	}

	/**
	 * 处理剪切快捷键
	 */
	private async handleCutShortcut(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		await this.renderCallbacks.onCutNode?.(node);
	}

	/**
	 * 处理粘贴快捷键
	 */
	private async handlePasteShortcut(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		await this.renderCallbacks.onPasteToNode?.(node);
	}

	/**
	 * 处理撤销快捷键
	 */
	private handleUndoShortcut(): void {
		this.renderCallbacks.onUndo?.();
	}

	/**
	 * 处理重做快捷键
	 */
	private handleRedoShortcut(): void {
		this.renderCallbacks.onRedo?.();
	}
}
