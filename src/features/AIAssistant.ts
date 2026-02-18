/**
 * AI Assistant - AI 节点建议功能
 *
 * 【职责】
 * - 渲染 AI 建议按钮
 * - 触发 AI 请求获取子节点建议
 * - 显示建议面板
 * - 处理建议选择和节点创建
 * - 管理加载状态和已选择建议
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理自己的状态（selectedSuggestions, loadingNotice）
 * - 提供清晰的 API 用于按钮渲染和触发
 *
 * 【重构来源】
 * 从 D3TreeRenderer.ts 提取（Phase 3.1）
 * - renderAISuggestButton() → renderAIButton()
 * - removeAISuggestButton() → removeAIButton()
 * - triggerAISuggestions() → triggerSuggestions()
 * - showSuggestionsPanel() → showSuggestionsPanel()
 * - createChildFromSuggestion() → createChildFromSuggestion()
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n';

/**
 * AI Assistant 回调接口
 */
export interface AIAssistantCallbacks {
	/**
	 * 节点创建成功后调用，用于刷新渲染
	 */
	onNodeCreated?: () => void;
}

/**
 * 节点尺寸接口（简化版）
 */
export interface NodeDimensions {
	width: number;
	height: number;
}

/**
 * AI Assistant 类
 *
 * 管理 AI 节点建议的完整生命周期
 */
export class AIAssistant {
	// 已选择的建议追踪
	private selectedSuggestions: Set<string> = new Set();

	// AI 建议加载提示
	private loadingNotice: Notice | null = null;

	constructor(
		private mindMapService: MindMapService,
		private messages: MindMapMessages,
		private callbacks: AIAssistantCallbacks = {}
	) {}

	/**
	 * 渲染 AI 建议按钮
	 *
	 * @param nodeElement 节点元素选择集
	 * @param node 节点数据
	 * @param dimensions 节点尺寸
	 */
	renderAIButton(
		nodeElement: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, null, undefined>,
		node: d3.HierarchyNode<MindMapNode>,
		dimensions: NodeDimensions
	): void {
		// 检查是否已经存在 AI 按钮
		const existingAIButton = nodeElement.select(".ai-suggest-button-group");
		if (!existingAIButton.empty()) {
			return; // AI 按钮已存在则不重复创建
		}

		// 计算两个按钮的总高度（+号按钮20px + 间距10px + AI按钮20px = 50px）
		const totalButtonsHeight = 20 + 10 + 20;
		// AI按钮位于下方位置：+号按钮Y位置 + 20px (+号按钮高度) + 10px (间距)
		const buttonY = (dimensions.height - totalButtonsHeight) / 2 + 20 + 10;
		const buttonX = dimensions.width + 4; // 与+号按钮水平对齐

		// 创建 AI 建议按钮组
		const buttonGroup = nodeElement.append("g")
			.attr("class", "ai-suggest-button-group")
			.attr("transform", `translate(${buttonX}, ${buttonY})`);

		// 添加点击事件处理器
		buttonGroup.on("click", (event: MouseEvent) => {
			event.stopPropagation();
			this.triggerSuggestions(node);
		});

		// 创建圆形背景（紫色）
		buttonGroup.append("circle")
			.attr("class", "ai-suggest-button-bg")
			.attr("cx", 10)
			.attr("cy", 10)
			.attr("r", 10)
			.attr("fill", "#9333ea")  // 紫色背景
			.style("opacity", 0.9)
			.style("cursor", "pointer");

		// 创建 emoji 图标
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

		// 添加标题提示
		buttonGroup.append("title")
			.text("AI Suggestions");
	}

	/**
	 * 移除 AI 建议按钮
	 *
	 * @param nodeElement 节点元素选择集
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
	 * 触发 AI 建议请求
	 *
	 * @param node 要获取建议的节点
	 */
	async triggerSuggestions(node: d3.HierarchyNode<MindMapNode>): Promise<void> {
		// 验证服务可用性
		if (!this.mindMapService) {
			new Notice(this.messages.errors.serviceNotAvailable);
			return;
		}

		// 空节点验证
		const nodeText = node.data.text?.trim() || '';

		if (!nodeText) {
			new Notice(this.messages.errors.emptyNodeError);
			return;
		}

		// 清理之前的加载提示（如果存在）
		if (this.loadingNotice) {
			this.loadingNotice.hide();
			this.loadingNotice = null;
		}

		// 显示持久化的加载提示（无超时，会持续显示直到手动隐藏）
		this.loadingNotice = new Notice(this.messages.format(
			this.messages.notices.aiAnalyzing,
			{ nodeText }
		), 0);

		try {
			// 调用 MindMapService 获取建议
			const suggestions = await this.mindMapService.suggestChildNodes(node.data);

			// 成功后隐藏加载提示
			if (this.loadingNotice) {
				this.loadingNotice.hide();
				this.loadingNotice = null;
			}

			if (suggestions.length === 0) {
				new Notice(this.messages.notices.aiNoSuggestions);
				return;
			}

			// 显示建议面板
			this.showSuggestionsPanel(node, suggestions);
		} catch (error) {

			// 错误时也隐藏加载提示
			if (this.loadingNotice) {
				this.loadingNotice.hide();
				this.loadingNotice = null;
			}

			const errorMsg = this.messages.format(
				this.messages.notices.aiFailed,
				{ error: error.message }
			);
			new Notice(errorMsg);
		}
	}

	/**
	 * 显示建议列表面板
	 *
	 * @param node 父节点
	 * @param suggestions 建议列表
	 */
	private showSuggestionsPanel(
		node: d3.HierarchyNode<MindMapNode>,
		suggestions: string[]
	): void {
		// 移除旧面板
		this.hideSuggestionsPanel();

		// 创建面板容器
		const panel = document.createElement("div");
		panel.className = "ai-suggestions-panel";

		// 标题和操作按钮区域
		const header = document.createElement("div");
		header.className = "ai-suggestions-header";

		const title = document.createElement("h4");
		title.textContent = this.messages.ui.aiSuggestionsTitle;

		// 操作按钮容器
		const actionButtons = document.createElement("div");
		actionButtons.className = "ai-suggestions-actions";

		// 全选按钮
		const selectAllBtn = document.createElement("button");
		selectAllBtn.className = "ai-suggestions-select-all";
		selectAllBtn.textContent = this.messages.ui.aiAddAll;
		selectAllBtn.title = this.messages.ui.aiAddAllTooltip;
		selectAllBtn.onclick = () => {
			suggestions.forEach(suggestion => {
				if (!this.selectedSuggestions.has(suggestion)) {
					// 查找对应的列表项
					const listItem = Array.from(list.children).find(
						item => item.textContent?.includes(suggestion)
					) as HTMLElement;
					this.createChildFromSuggestion(node, suggestion, listItem);
				}
			});
		};

		// 关闭按钮
		const closeBtn = document.createElement("button");
		closeBtn.className = "ai-suggestions-close";
		closeBtn.textContent = this.messages.ui.aiClose;
		closeBtn.onclick = () => this.hideSuggestionsPanel();

		actionButtons.appendChild(selectAllBtn);
		actionButtons.appendChild(closeBtn);
		header.appendChild(title);
		header.appendChild(actionButtons);
		panel.appendChild(header);

		// 建议列表
		const list = document.createElement("ul");
		list.className = "ai-suggestions-list";

		suggestions.forEach((suggestion) => {
			const item = document.createElement("li");
			item.className = "ai-suggestion-item";

			// 检查是否已选择（用于面板重新打开的情况）
			const isSelected = this.selectedSuggestions.has(suggestion);
			if (isSelected) {
				item.classList.add('ai-suggestion-item-selected');
			}

			// 创建对勾占位元素
			const checkmark = document.createElement("span");
			checkmark.className = "ai-suggestion-checkmark";
			checkmark.textContent = isSelected ? '✓' : '';

			// 创建建议文本
			const text = document.createElement("span");
			text.className = "ai-suggestion-text";
			text.textContent = suggestion;

			item.appendChild(checkmark);
			item.appendChild(text);

			// 点击事件：如果未选择才创建
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

		// 添加到 document.body（避免被重新渲染移除）
		document.body.appendChild(panel);
	}

	/**
	 * 关闭建议面板
	 */
	private hideSuggestionsPanel(): void {
		const panel = document.querySelector(".ai-suggestions-panel");
		if (panel) {
			panel.remove();
		}
	}

	/**
	 * 从建议创建子节点
	 *
	 * @param parentNode 父节点
	 * @param suggestion 建议文本
	 * @param listItemElement 列表项元素（可选，用于更新UI）
	 */
	private createChildFromSuggestion(
		parentNode: d3.HierarchyNode<MindMapNode>,
		suggestion: string,
		listItemElement?: HTMLElement
	): void {
		// 防止重复创建相同建议
		if (this.selectedSuggestions.has(suggestion)) {
			new Notice(this.messages.format(
				this.messages.notices.alreadyAdded || `Already added: {nodeText}`,
				{ nodeText: suggestion }
			));
			return;
		}

		try {
			// 创建子节点
			this.mindMapService.createChildNode(parentNode.data, suggestion);

			// 追踪已选择的建议
			this.selectedSuggestions.add(suggestion);

			// 刷新渲染
			this.callbacks.onNodeCreated?.();

			// 标记列表项为已选择（如果提供了列表项元素）
			if (listItemElement) {
				listItemElement.classList.add('ai-suggestion-item-selected');
				// 显示对勾图标
				const checkmark = listItemElement.querySelector('.ai-suggestion-checkmark');
				if (checkmark) {
					checkmark.textContent = '✓';
				}
			}

			// 显示成功提示
			new Notice(this.messages.format(
				this.messages.notices.nodeCreated || `Created: {nodeText}`,
				{ nodeText: suggestion }
			));

			// 不再自动关闭面板，允许用户继续选择其他建议
		} catch (error) {
			new Notice(this.messages.format(
				this.messages.notices.nodeCreateFailed || `Failed to create node: {error}`,
				{ error: error.message }
			));
		}
	}

	/**
	 * 清除已选择建议的追踪
	 *
	 * 当切换到不同的节点或重新打开 mind map 时调用
	 */
	clearSelectedSuggestions(): void {
		this.selectedSuggestions.clear();
	}

	/**
	 * 销毁 AI Assistant
	 *
	 * 清理资源和隐藏面板
	 */
	destroy(): void {
		// 隐藏建议面板
		this.hideSuggestionsPanel();

		// 隐藏加载提示
		if (this.loadingNotice) {
			this.loadingNotice.hide();
			this.loadingNotice = null;
		}

		// 清空已选择建议
		this.selectedSuggestions.clear();
	}
}
