/**
 * Clipboard Manager - 剪贴板管理功能
 *
 * 【职责】
 * - 复制节点/子树到剪贴板（markdown 格式）
 * - 从剪贴板粘贴文本创建子节点/子树
 * - 剪切节点（复制+删除）
 * - 剪贴板内容格式检测（markdown vs 普通文本）
 * - 成功/失败提示
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理自己的剪贴板操作
 * - 提供清晰的 API 用于剪贴板操作
 * - 智能降级（现代 API → 传统方法）
 *
 * 【重构来源】
 * 从 D3TreeRenderer.ts 提取（Phase 3.3）
 * - handleToolbarCopyClick() → copyNode()
 * - handleToolbarPasteClick() → pasteToNode()
 * - fallbackCopyTextToClipboard() → fallbackCopy()
 * - showCopySuccessNotice() → (内置)
 * - showCopyErrorNotice() → (内置)
 */

import * as d3 from 'd3';
import { Notice } from 'obsidian';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n';
import { VALIDATION_CONSTANTS } from '../constants/mindmap-constants';

/**
 * Clipboard Manager 回调接口
 */
export interface ClipboardManagerCallbacks {
	/**
	 * 粘贴后需要刷新数据时调用
	 */
	onDataUpdated?: () => void;

	/**
	 * 粘贴后需要清除选择时调用
	 */
	clearSelection?: () => void;
}

/**
 * Clipboard Manager 类
 *
 * 管理剪贴板的完整操作生命周期
 */
export class ClipboardManager {
	constructor(
		private mindMapService: MindMapService,
		private messages: MindMapMessages,
		private callbacks: ClipboardManagerCallbacks = {}
	) {}

	/**
	 * 复制节点到剪贴板（序列化为 markdown 格式）
	 *
	 * @param node 要复制的节点
	 * @returns Promise<boolean> 是否成功
	 */
	async copyNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		try {
			// 序列化整个子树为 markdown 格式
			const markdown = this.mindMapService.serializeSubtreeToMarkdown(node.data);

			// 使用 Clipboard API 复制文本到剪贴板
			if (navigator.clipboard && window.isSecureContext) {
				// 使用现代 Clipboard API（支持移动端和桌面端）
				try {
					await navigator.clipboard.writeText(markdown);
					this.showSuccessNotice(this.messages.notices.nodeTextCopied);
					return true;
				} catch (err) {
					// 降级方案：使用传统方法
					return this.fallbackCopy(markdown);
				}
			} else {
				// 降级方案：使用传统方法
				return this.fallbackCopy(markdown);
			}
		} catch (error) {
			this.showErrorNotice(this.messages.notices.copyFailed);
			return false;
		}
	}

	/**
	 * 剪切节点（复制+删除）
	 *
	 * @param node 要剪切的节点
	 * @returns Promise<boolean> 是否成功
	 */
	async cutNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		// 先执行复制操作
		const copySuccess = await this.copyNode(node);

		if (copySuccess) {
			// 复制成功后执行删除
			const deleteSuccess = this.mindMapService.deleteNode(node.data);

			if (deleteSuccess) {
				// 清除选中状态
				this.callbacks.clearSelection?.();

				// 触发数据更新
				this.callbacks.onDataUpdated?.();
				return true;
			}
		}

		return false;
	}

	/**
	 * 粘贴剪贴板内容到节点
	 *
	 * @param node 目标节点（将作为父节点）
	 * @returns Promise<boolean> 是否成功
	 */
	async pasteToNode(node: d3.HierarchyNode<MindMapNode>): Promise<boolean> {
		try {
			// 检查 Clipboard API 是否可用
			if (!navigator.clipboard || !window.isSecureContext) {
				return false;
			}

			// 读取剪贴板内容
			const clipboardText = await navigator.clipboard.readText();

			// 静默失败：如果剪贴板为空或无法读取，直接返回
			if (!clipboardText || clipboardText.trim().length === 0) {
				return false;
			}

			// 检查剪贴板内容是否为 markdown 格式（包含列表标记）
			const isMarkdownFormat = /^\s*[-*]/m.test(clipboardText);

			if (isMarkdownFormat) {
				// 如果是 markdown 格式，尝试创建子树
				return this.pasteSubtree(node, clipboardText);
			} else {
				// 普通文本，创建单个子节点
				return this.pasteText(node, clipboardText);
			}
		} catch (error) {
			// 静默失败：不显示任何错误提示
			return false;
		}
	}

	/**
	 * 销毁
	 */
	destroy(): void {
		// 清理资源（如果需要）
	}

	// ========== 私有方法 ==========

	/**
	 * 降级复制方案（兼容旧浏览器）
	 *
	 * Note: This uses the deprecated execCommand as a fallback for older browsers
	 * that don't support the modern Clipboard API. The modern API is tried first
	 * in copyNode(). This fallback is only used when:
	 * - navigator.clipboard is not available (older browsers)
	 * - window.isSecureContext is false (non-HTTPS contexts)
	 * - The Clipboard API call throws an error
	 */
	private fallbackCopy(text: string): boolean {
		const textArea = document.createElement("textarea");
		textArea.value = text;

		// Set individual style properties for better maintainability
		textArea.style.position = 'fixed';
		textArea.style.top = '0';
		textArea.style.left = '0';
		textArea.style.width = '2em';
		textArea.style.height = '2em';
		textArea.style.padding = '0';
		textArea.style.border = 'none';
		textArea.style.outline = 'none';
		textArea.style.boxShadow = 'none';
		textArea.style.background = 'transparent';
		textArea.style.opacity = '0';
		textArea.style.pointerEvents = 'none';

		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();

		try {
			// eslint-disable-next-line deprecation/deprecation
			const successful = document.execCommand('copy');
			if (successful) {
				this.showSuccessNotice(this.messages.notices.nodeTextCopied);
				return true;
			} else {
				this.showErrorNotice(this.messages.notices.copyFailed);
				return false;
			}
		} catch (err) {
			this.showErrorNotice(this.messages.notices.copyFailed);
			return false;
		} finally {
			document.body.removeChild(textArea);
		}
	}

	/**
	 * 粘贴子树（markdown 格式）
	 */
	private pasteSubtree(
		node: d3.HierarchyNode<MindMapNode>,
		clipboardText: string
	): boolean {
		// 尝试从 markdown 创建子树
		const subtreeRoot = this.mindMapService.createSubtreeFromMarkdown(
			clipboardText,
			node.data.level
		);

		if (subtreeRoot) {
			// 设置父节点
			subtreeRoot.parent = node.data;
			node.data.children.push(subtreeRoot);

			// 清除当前选择
			this.callbacks.clearSelection?.();

			// 修复：直接在数据层设置选中状态
			subtreeRoot.selected = true;

			// 触发数据更新
			this.callbacks.onDataUpdated?.();
			return true;
		} else {
			// 如果解析失败，回退到普通文本处理
			return this.pasteText(node, clipboardText);
		}
	}

	/**
	 * 粘贴普通文本（创建单个子节点）
	 */
	private pasteText(
		node: d3.HierarchyNode<MindMapNode>,
		clipboardText: string
	): boolean {
		// 限制文本长度为最大允许长度
		const truncatedText = clipboardText.substring(0, VALIDATION_CONSTANTS.MAX_TEXT_LENGTH);

		// 创建子节点
		const childNode = this.mindMapService.createChildNode(node.data, truncatedText);

		// 清除当前选择
		this.callbacks.clearSelection?.();

		// 修复：直接在数据层设置选中状态
		childNode.selected = true;

		// 触发数据更新
		this.callbacks.onDataUpdated?.();
		return true;
	}

	/**
	 * 显示成功提示
	 */
	private showSuccessNotice(message: string): void {
		new Notice(message, 2000);
	}

	/**
	 * 显示错误提示
	 */
	private showErrorNotice(message: string): void {
		new Notice(message, 3000);
	}
}
