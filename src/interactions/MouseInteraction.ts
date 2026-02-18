import * as d3 from 'd3';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MouseInteractionCallbacks, MouseInteractionOptions } from './MouseInteractionCallbacks';

/**
 * MouseInteraction - 处理所有鼠标交互逻辑
 *
 * 【职责】
 * - 节点点击选择（含双击检测）
 * - 节点悬停效果
 * - 画布拖拽
 * - 画布点击（取消选择）
 * - 事件委托和分发
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理交互状态（selectedNode, hoveredNode）
 * - 提供清晰的 API 用于附加事件处理器
 */
export class MouseInteraction {
	// ========== 状态 ==========

	/** 当前选中的节点 */
	private selectedNode: d3.HierarchyNode<MindMapNode> | null = null;

	/** 当前悬停的节点 */
	private hoveredNode: d3.HierarchyNode<MindMapNode> | null = null;

	// 双击检测机制
	private clickTimeout: ReturnType<typeof setTimeout> | null = null;
	private lastClickTime = 0;
	private clickNode: d3.HierarchyNode<MindMapNode> | null = null;

	// 配置选项
	private readonly options: Required<MouseInteractionOptions>;

	// ========== 构造函数 ==========

	constructor(
		private callbacks: MouseInteractionCallbacks
	) {
		// 默认配置
		this.options = {
			doubleClickTimeout: 300,
			enableCanvasDrag: true,
			...callbacks
		};
	}

	// ========== 公共 API ==========

	/**
	 * 为节点附加点击事件处理器
	 *
	 * @param nodeElements D3 选择集，包含所有节点组
	 */
	attachNodeClickHandlers(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		const self = this;

		nodeElements.each((d, i, nodes) => {
			const nodeElement = d3.select(nodes[i]);
			const nodeRect = nodeElement.select<SVGRectElement>(".node-rect");

			// 点击事件处理器
			nodeElement.on("click", (event: MouseEvent) => {
				self.handleNodeClick(event, d, nodeRect as d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>);
			});
		});
	}

	/**
	 * 为节点附加悬停事件处理器
	 *
	 * @param nodeElements D3 选择集，包含所有节点组
	 */
	attachNodeHoverHandlers(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		const self = this;

		nodeElements.each((d, i, nodes) => {
			const nodeElement = d3.select(nodes[i]);
			const nodeRect = nodeElement.select<SVGRectElement>(".node-rect");

			// 鼠标进入事件
			nodeElement.on("mouseenter", (event: MouseEvent) => {
				self.handleNodeHover(event, d, nodeRect as d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>);
			});

			// 鼠标离开事件
			nodeElement.on("mouseleave", (event: MouseEvent) => {
				self.handleNodeLeave(event, d, nodeRect as any);
			});
		});
	}

	/**
	 * 为画布附加拖拽事件处理器
	 *
	 * @param svg SVG 元素的选择集
	 */
	attachCanvasDragHandlers(
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>
	): void {
		if (!this.options.enableCanvasDrag) {
			return;
		}

		let isDragging = false;
		let dragStartX = 0;
		let dragStartY = 0;

		svg.on("mousedown", (event: MouseEvent) => {
			const target = event.target as HTMLElement;

			// 如果点击的是正在编辑的元素，不要干预，让事件正常传递
			if (target.contentEditable === "true" || target.closest('[contenteditable="true"]')) {
				return; // 让事件正常传递到 contenteditable 元素
			}

			// 检查画布交互是否启用
			if (event.button === 0 && this.isCanvasInteractionEnabled()) {
				isDragging = true;
				dragStartX = event.clientX;
				dragStartY = event.clientY;
				svg.style("cursor", "grabbing");
			}
		});

		svg.on("mousemove", (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const isContentEditable = target.contentEditable === "true" || target.closest('[contenteditable="true"]');
			const canvasEnabled = this.isCanvasInteractionEnabled();

			// 检查是否在可编辑元素上，如果是则不处理拖拽
			if (isContentEditable) {
				return;
			}

			if (isDragging && canvasEnabled) {
				// 关键日志：只有真正执行拖拽时才打印
				console.warn("[MouseInteraction] 🚨 CANVAS DRAG EXECUTED!", {
					target: target.tagName,
					isDragging,
					canvasEnabled,
					isContentEditable
				});
				const dx = event.clientX - dragStartX;
				const dy = event.clientY - dragStartY;

				// 触发拖拽回调
				this.callbacks.onCanvasDrag?.(dx, dy);
			}
		});

		svg.on("mouseup", () => {
			if (this.isCanvasInteractionEnabled()) {
				isDragging = false;
				svg.style("cursor", "grab");
			}
		});

		svg.on("mouseleave", () => {
			if (this.isCanvasInteractionEnabled()) {
				isDragging = false;
				svg.style("cursor", "grab");
			}
		});
	}

	/**
	 * 为画布附加点击事件处理器（用于取消选择）
	 *
	 * @param svg SVG 元素的选择集
	 */
	attachCanvasClickHandler(
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>
	): void {
		const svgNode = svg.node() as SVGSVGElement;

		svgNode.addEventListener("click", (event: MouseEvent) => {
			const target = event.target as SVGElement;
			const isNodeElement = this.isNodeElement(target);

			if (!isNodeElement) {
				this.clearSelection();
				this.callbacks.onCanvasClick?.();
			}
		}, true); // 使用捕获阶段
	}

	/**
	 * 清除所有选择状态
	 */
	clearSelection(): void {
		if (this.selectedNode) {
			// 清除数据层状态
			this.selectedNode.data.selected = false;

			// 清除视觉效果
			d3.selectAll<SVGRectElement, d3.HierarchyNode<MindMapNode>>(".node-rect")
				.classed("selected-rect", false);

			// 移除选中节点的按钮
			const selectedNodeElement = d3.selectAll('.nodes g')
				.filter((d: d3.HierarchyNode<MindMapNode>) => d === this.selectedNode);

			selectedNodeElement.select('.plus-button-group').remove();
			selectedNodeElement.select('.ai-suggest-button-group').remove();

			// 清空选中节点引用
			this.selectedNode = null;
		}
	}

	/**
	 * 获取当前选中的节点
	 */
	getSelectedNode(): d3.HierarchyNode<MindMapNode> | null {
		return this.selectedNode;
	}

	/**
	 * 销毁鼠标交互处理器
	 */
	destroy(): void {
		// 清理点击超时
		if (this.clickTimeout) {
			clearTimeout(this.clickTimeout);
			this.clickTimeout = null;
		}

		// 清理状态
		this.selectedNode = null;
		this.hoveredNode = null;
		this.clickNode = null;
	}

	// ========== 私有方法 - 事件处理 ==========

	/**
	 * 处理节点点击（含双击检测）
	 */
	private handleNodeClick(
		event: MouseEvent,
		node: d3.HierarchyNode<MindMapNode>,
		nodeRect: d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {

		const currentTime = Date.now();
		const timeDiff = currentTime - this.lastClickTime;
		const isDoubleClick = timeDiff < this.options.doubleClickTimeout && this.clickNode === node;

		if (isDoubleClick) {
			// 双击事件
			this.lastClickTime = 0;
			this.clickNode = null;
			if (this.clickTimeout) {
				clearTimeout(this.clickTimeout);
				this.clickTimeout = null;
			}

			// 阻止双击事件冒泡到 SVG 容器，防止触发 D3 zoom 缩放
			event.stopPropagation();
			// 不调用 preventDefault()，允许浏览器的默认光标定位行为
			// event.preventDefault();

			// 触发双击回调 - 传递原始事件
			this.callbacks.onNodeDoubleClick?.(node, event);
			return;
		}

		// 单击处理
		this.lastClickTime = currentTime;
		this.clickNode = node;

		// 清除之前的 timeout
		if (this.clickTimeout) {
			clearTimeout(this.clickTimeout);
		}

		// 立即执行选中逻辑
		this.performNodeSelection(node, nodeRect);

		// 设置 timeout 用于双击检测的时间窗口
		this.clickTimeout = setTimeout(() => {
			this.lastClickTime = 0;
			this.clickNode = null;
			this.clickTimeout = null;
		}, this.options.doubleClickTimeout);

		// 阻止事件冒泡
		event.stopPropagation();
	}

	/**
	 * 执行节点选择逻辑
	 */
	private performNodeSelection(
		node: d3.HierarchyNode<MindMapNode>,
		nodeRect: d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		// 如果正在编辑，检查是否点击的是不同的节点
		if (this.callbacks.isEditing?.()) {
			const editingNode = this.callbacks.getEditingNode?.();
			// 如果点击的是正在编辑的同一个节点，忽略点击
			if (editingNode === node) {
				return;
			}
			// 如果点击的是不同的节点，允许继续（会触发 blur 事件保存当前节点）
		}

		// 清除之前选中的节点（如果存在且不是当前节点）
		if (this.selectedNode && this.selectedNode !== node) {
			this.selectedNode.data.selected = false;

			// 更新之前选中节点的视觉状态
			d3.selectAll<SVGRectElement, d3.HierarchyNode<MindMapNode>>(".node-rect")
				.filter((d: d3.HierarchyNode<MindMapNode>) => d === this.selectedNode)
				.classed("selected-rect", false);

			// 移除之前选中节点的按钮
			const previousNodeElement = d3.selectAll('.nodes g')
				.filter((d: d3.HierarchyNode<MindMapNode>) => d === this.selectedNode);

			previousNodeElement.select('.plus-button-group').remove();
			previousNodeElement.select('.ai-suggest-button-group').remove();
		}

		// 清除当前节点的悬停状态（选中状态优先级高于悬停状态）
		if (node.data.hovered) {
			this.clearNodeHoverState(node, nodeRect);
		}

		// 设置选中状态
		node.data.selected = true;
		this.selectedNode = node;
		nodeRect.classed("selected-rect", true);

		// 触发选中回调
		this.callbacks.onNodeSelect?.(node);
	}

	/**
	 * 处理节点悬停
	 */
	private handleNodeHover(
		event: MouseEvent,
		node: d3.HierarchyNode<MindMapNode>,
		nodeRect: d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		// 如果节点已经是选中状态，不应用悬停效果
		if (node.data.selected) {
			return;
		}

		// 清除之前的悬停状态
		if (this.hoveredNode && this.hoveredNode !== node) {
			this.clearHoverState();
		}

		// 设置新的悬停状态
		this.hoveredNode = node;
		node.data.hovered = true;

		// 应用悬停视觉效果
		nodeRect.classed("hovered-rect", true);

		// 触发悬停回调
		this.callbacks.onNodeHover?.(node);
	}

	/**
	 * 处理节点离开
	 */
	private handleNodeLeave(
		event: MouseEvent,
		node: d3.HierarchyNode<MindMapNode>,
		nodeRect: d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		// 如果节点是选中状态，不清除悬停状态（选中状态优先级更高）
		if (node.data.selected) {
			return;
		}

		// 清除悬停状态
		this.clearNodeHoverState(node, nodeRect);

		// 触发离开回调
		this.callbacks.onNodeLeave?.(node);
	}

	/**
	 * 清除单个节点的悬停状态
	 */
	private clearNodeHoverState(
		node: d3.HierarchyNode<MindMapNode>,
		nodeRect: d3.Selection<SVGRectElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>
	): void {
		node.data.hovered = false;
		nodeRect.classed("hovered-rect", false);

		if (this.hoveredNode === node) {
			this.hoveredNode = null;
		}
	}

	/**
	 * 清除所有悬停状态
	 */
	private clearHoverState(): void {
		if (this.hoveredNode) {
			this.hoveredNode.data.hovered = false;

			// 移除所有节点的悬停视觉效果
			d3.selectAll<SVGRectElement, d3.HierarchyNode<MindMapNode>>(".node-rect")
				.classed("hovered-rect", false);

			this.hoveredNode = null;
		}
	}

	// ========== 私有辅助方法 ==========

	/**
	 * 检查画布交互是否启用
	 */
	private isCanvasInteractionEnabled(): boolean {
		return this.callbacks.isCanvasInteractionEnabled?.() ?? true;
	}

	/**
	 * 检查 SVG 元素是否为节点元素
	 */
	private isNodeElement(target: SVGElement): boolean {
		const targetTagName = target.tagName.toLowerCase();
		const targetClasses = target.classList;

		return (
			(targetTagName === 'g' && targetClasses.contains('node')) ||      // 节点组
			targetClasses.contains('node-rect') ||                         // 节点矩形
			targetClasses.contains('node-text-layer') ||                    // 节点文本层
			targetTagName === 'foreignobject' ||                            // 节点 foreignObject
			targetTagName === 'div' ||                                     // 节点文本 div
			(targetTagName === 'g' && targetClasses.contains('node-group'))  // 其他可能的节点组
		);
	}
}
