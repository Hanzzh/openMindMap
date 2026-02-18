/**
 * Mobile Toolbar - 移动端工具栏功能
 *
 * 【职责】
 * - 创建和管理共享工具栏（编辑、复制、粘贴、删除）
 * - 更新工具栏位置和显示状态
 * - 处理工具栏按钮点击事件
 * - 提供震动反馈（移动端）
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理工具栏的显示、隐藏和位置更新
 * - 提供清晰的 API 用于工具栏操作
 *
 * 【重构来源】
 * 从 D3TreeRenderer.ts 提取（Phase 3.5）
 * - createToolbarContent() → create()
 * - createToolbarButton() → (内部方法)
 * - updateSharedToolbar() → updatePosition()
 * - hideSharedToolbar() → hide()
 * - attachToolbarButtonHandlers() → attachHandlers()
 * - handleToolbar*Click() → (通过回调处理)
 */

import * as d3 from 'd3';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { TextMeasurer } from '../utils/TextMeasurer';
import { MindMapMessages } from '../i18n';

/**
 * Mobile Toolbar 回调接口
 */
export interface MobileToolbarCallbacks {
	/**
	 * 编辑按钮点击时调用
	 */
	onEdit?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * 复制按钮点击时调用
	 */
	onCopy?: (node: d3.HierarchyNode<MindMapNode>) => Promise<void>;

	/**
	 * 粘贴按钮点击时调用
	 */
	onPaste?: (node: d3.HierarchyNode<MindMapNode>) => Promise<void>;

	/**
	 * 删除按钮点击时调用
	 */
 onDelete?: (node: d3.HierarchyNode<MindMapNode>) => void;
}

/**
 * Mobile Toolbar 类
 *
 * 管理移动端工具栏的完整生命周期
 */
export class MobileToolbar {
	private toolbar: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
	private currentNode: d3.HierarchyNode<MindMapNode> | null = null;

	constructor(
		private textMeasurer: TextMeasurer,
		private messages: MindMapMessages,
		private callbacks: MobileToolbarCallbacks = {}
	) {}

	/**
	 * 创建共享工具栏
	 *
	 * @param svg SVG 选择集
	 */
	create(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		// 🔧 简化：如果已存在，先销毁再创建（确保唯一性和有效性）
		if (this.toolbar) {
			this.toolbar.remove();
			this.toolbar = null;
		}

		// 🔧 修复：创建在 content 组内，确保在正确的SVG层级（参照重构前实现）
		const content = svg.select(".mindmap-content");
		if (content.empty()) {
			return;
		}

		const toolbarGroup = content.append("g")
			.attr("class", "shared-node-toolbar")
			.style("display", "none");

		// 创建工具栏内容
		this.createToolbarContent(toolbarGroup);

		// 保存引用
		this.toolbar = toolbarGroup;
	}

	/**
	 * 更新工具栏位置和显示状态
	 *
	 * @param node 关联的节点
	 * @param offsetX X轴偏移量
	 * @param offsetY Y轴偏移量
	 */
	updatePosition(
		node: d3.HierarchyNode<MindMapNode>,
		offsetX: number,
		offsetY: number
	): void {
		if (!this.toolbar) {
			return;
		}

		// 获取节点尺寸
		const dimensions = this.textMeasurer.getNodeDimensions(node.depth, node.data.text);

		// 计算工具栏绝对位置（使用画布坐标）
		const nodeCanvasX = node.y + offsetX;  // 节点的水平位置
		// node.x 是布局坐标的中心点，需要转换为画布坐标的顶边位置
		const nodeCanvasY = node.x + offsetY - dimensions.height / 2;  // 节点的垂直位置（顶边）

		const toolbarWidth = 320;
		const toolbarHeight = 44;

		// 工具栏相对于节点的偏移
		const toolbarOffsetX = (dimensions.width - toolbarWidth) / 2;  // 水平居中
		const toolbarOffsetY = -toolbarHeight - 12;  // 节点上方12px

		// 工具栏的绝对坐标
		const toolbarX = nodeCanvasX + toolbarOffsetX;
		const toolbarY = nodeCanvasY + toolbarOffsetY;

		// 更新工具栏位置
		// 中断任何正在进行的过渡动画，确保工具栏立即响应
		this.toolbar
			.interrupt()
			.attr("transform", `translate(${toolbarX}, ${toolbarY})`)
			.style("display", "block")
			.style("opacity", 0);

		// 保存当前关联的节点
		this.currentNode = node;

		// 更新按钮事件监听器（使用新的节点引用）
		this.attachHandlers(node);

		// 平滑淡入动画
		requestAnimationFrame(() => {
			if (this.toolbar) {
				this.toolbar
					.style("transition", "opacity 0.15s ease-out")
					.style("opacity", 1);
			}
		});
	}

	/**
	 * 隐藏工具栏
	 */
	hide(): void {
		if (!this.toolbar) {
			return;
		}

		this.toolbar
			.style("opacity", 0)
			.transition()
			.duration(150)
			.on("end", () => {
				this.toolbar?.style("display", "none");
				// 只在动画完成后清除节点引用
				this.currentNode = null;
			});
	}

	/**
	 * 销毁
	 */
	destroy(): void {
		if (this.toolbar) {
			this.toolbar.remove();
			this.toolbar = null;
		}
		this.currentNode = null;
	}

	// ========== 私有方法 ==========

	/**
	 * 创建工具栏内容
	 */
	private createToolbarContent(
		toolbarGroup: d3.Selection<SVGGElement, unknown, null, undefined>
	): void {
		const toolbarWidth = 400;
		const toolbarHeight = 44;

		// 工具栏背景（黑色圆角矩形）
		toolbarGroup.append("rect")
			.attr("class", "toolbar-bg")
			.attr("width", toolbarWidth)
			.attr("height", toolbarHeight)
			.attr("rx", 8)
			.attr("ry", 8)
			.attr("fill", "#000000");

		// 工具栏箭头（指向节点）
		toolbarGroup.append("path")
			.attr("class", "toolbar-arrow")
			.attr("d", "M 200 52 L 192 44 L 208 44 Z")
			.attr("fill", "#000000");

		// 三条分隔线
		for (let i = 1; i <= 3; i++) {
			toolbarGroup.append("line")
				.attr("class", "toolbar-separator")
				.attr("x1", (toolbarWidth / 4) * i)
				.attr("y1", 8)
				.attr("x2", (toolbarWidth / 4) * i)
				.attr("y2", toolbarHeight - 8)
				.attr("stroke", "#333333")
				.attr("stroke-width", 1);
		}

		// 创建四个按钮
		this.createToolbarButton(toolbarGroup, 0, toolbarWidth, toolbarHeight, "edit");
		this.createToolbarButton(toolbarGroup, 1, toolbarWidth, toolbarHeight, "copy");
		this.createToolbarButton(toolbarGroup, 2, toolbarWidth, toolbarHeight, "paste");
		this.createToolbarButton(toolbarGroup, 3, toolbarWidth, toolbarHeight, "delete");
	}

	/**
	 * 创建工具栏按钮
	 */
	private createToolbarButton(
		toolbarGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
		index: number,
		toolbarWidth: number,
		toolbarHeight: number,
		type: string
	): void {
		const buttonGroup = toolbarGroup.append("g")
			.attr("class", `toolbar-btn ${type}-btn`)
			.style("cursor", "pointer");

		buttonGroup.append("rect")
			.attr("x", (toolbarWidth / 4) * index)
			.attr("width", toolbarWidth / 4)
			.attr("height", toolbarHeight)
			.attr("fill", "transparent")
			.attr("rx", 8)
			.attr("ry", 8);

		// 按钮图标和文本配置
		const buttonConfig = {
			edit: { icon: "✏️", text: this.messages.ui.contextEdit },
			copy: { icon: "📋", text: this.messages.ui.contextCopy },
			paste: { icon: "📑", text: this.messages.ui.contextPaste },
			delete: { icon: "🗑️", text: this.messages.ui.contextDelete }
		};

		const config = buttonConfig[type as keyof typeof buttonConfig];
		const buttonCenterX = (toolbarWidth / 4) * index + (toolbarWidth / 8);

		buttonGroup.append("text")
			.attr("x", buttonCenterX - 16)
			.attr("y", toolbarHeight / 2)
			.attr("dominant-baseline", "middle")
			.attr("text-anchor", "middle")
			.attr("fill", "#ffffff")
			.attr("font-size", "14px")
			.style("pointer-events", "none")
			.text(config.icon);

		buttonGroup.append("text")
			.attr("x", buttonCenterX + 16)
			.attr("y", toolbarHeight / 2)
			.attr("dominant-baseline", "middle")
			.attr("text-anchor", "middle")
			.attr("fill", "#ffffff")
			.attr("font-size", "14px")
			.attr("font-weight", "500")
			.style("pointer-events", "none")
			.text(config.text);
	}

	/**
	 * 附加工具栏按钮事件处理器
	 */
	private attachHandlers(node: d3.HierarchyNode<MindMapNode>): void {
		if (!this.toolbar) return;

		// 编辑按钮
		this.toolbar.select(".edit-btn")
			.on("click", (event: MouseEvent) => {
				this.handleButtonClick(event, node, "edit");
			});

		// 复制按钮
		this.toolbar.select(".copy-btn")
			.on("click", (event: MouseEvent) => {
				this.handleButtonClick(event, node, "copy");
			});

		// 粘贴按钮
		this.toolbar.select(".paste-btn")
			.on("click", (event: MouseEvent) => {
				this.handleButtonClick(event, node, "paste");
			});

		// 删除按钮
		this.toolbar.select(".delete-btn")
			.on("click", (event: MouseEvent) => {
				this.handleButtonClick(event, node, "delete");
			});
	}

	/**
	 * 处理工具栏按钮点击事件
	 */
	private handleButtonClick(
		event: MouseEvent,
		node: d3.HierarchyNode<MindMapNode>,
		type: string
	): void {
		event.stopPropagation(); // 阻止事件冒泡

		// 震动反馈（如果设备支持）
		if (navigator.vibrate) {
			navigator.vibrate(50);
		}

		// 触发相应的回调
		switch (type) {
			case "edit":
				this.callbacks.onEdit?.(node);
				break;
			case "copy":
				this.callbacks.onCopy?.(node);
				break;
			case "paste":
				this.callbacks.onPaste?.(node);
				break;
			case "delete":
				this.callbacks.onDelete?.(node);
				break;
		}
	}
}
