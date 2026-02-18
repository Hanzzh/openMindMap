/**
 * Node Editor - 节点编辑功能
 *
 * 【职责】
 * - 进入/退出编辑模式
 * - 文本验证
 * - 保存/取消编辑
 * - 编辑UI提示
 * - 处理编辑快捷键
 *
 * 【设计原则】
 * - 通过回调与外部通信，不直接依赖 D3TreeRenderer
 * - 管理自己的状态（editingState, canvasInteractionEnabled）
 * - 提供清晰的 API 用于编辑操作
 *
 * 【重构来源】
 * 从 D3TreeRenderer.ts 提取（Phase 3.2）
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

/**
 * Node Editor 回调接口
 */
export interface NodeEditorCallbacks {
	/**
	 * 文本改变前调用，用于保存 undo 快照
	 */
	onBeforeTextChange?: (node: d3.HierarchyNode<MindMapNode>) => void;

	/**
	 * 文本改变后调用，用于触发文件保存
	 */
	onTextChanged?: (node: d3.HierarchyNode<MindMapNode>, newText: string) => void;

	/**
	 * 画布交互状态改变时调用
	 */
	onCanvasInteractionChanged?: (enabled: boolean) => void;
}

/**
 * Node Editor 类
 *
 * 管理节点编辑的完整生命周期
 */
export class NodeEditor {
	// 编辑状态
	private editingState: EditingState;

	// 画布交互状态
	private canvasInteractionEnabled: boolean = true;

	constructor(
		private config: MindMapConfig,
		private messages: MindMapMessages,
		private callbacks: NodeEditorCallbacks = {},
		editingState?: EditingState  // ✅ 接收外部 editingState
	) {
		// 如果没有提供，创建内部状态（向后兼容）
		this.editingState = editingState || {
			isEditing: false,
			currentNode: null,
			originalText: '',
			editElement: null
		};
	}

	/**
	 * 启用节点编辑模式
	 *
	 * @param node 要编辑的节点
	 * @param editElement 可编辑的文本元素
	 */
	enableEditing(
		node: d3.HierarchyNode<MindMapNode>,
		editElement: HTMLDivElement
	): void {
		// 检查是否为根节点（中心主题），不允许编辑
		if (node.depth === 0) {
			this.showRootNodeEditWarning();
			return;
		}

		// 如果正在编辑其他节点，先退出编辑模式
		if (this.editingState.isEditing && this.editingState.currentNode !== node) {
			this.exitEditMode();
		}

		// 禁用画布交互（拖拽、缩放），允许文本选择和编辑
		this.setCanvasInteraction(false);

		// 设置编辑状态（修改属性，不重新赋值对象）
		this.editingState.isEditing = true;
		this.editingState.currentNode = node;
		this.editingState.originalText = node.data.text;
		this.editingState.editElement = editElement;

		try {
			// 设置为可编辑
			editElement.contentEditable = "true";

			// 添加编辑样式类
			editElement.classList.add("editing");

			// 添加节点编辑状态
			const nodeElement = d3.select(editElement.closest("g"));
			nodeElement.classed("node-editing", true);

			// 设置焦点并全选文本（使用 setTimeout 确保事件处理完成）
			setTimeout(() => {
				try {
					editElement.focus();

					// 全选文本 - 使用 range.selectNodeContents（与 tmp 分支一致）
					const range = document.createRange();
					range.selectNodeContents(editElement);
					const selection = window.getSelection();
					if (selection) {
						selection.removeAllRanges();
						selection.addRange(range);
					}
				} catch (focusError) {
					this.showValidationError(this.messages.errors.focusSetFailed);
					this.exitEditMode();
				}
			}, 10);

			// 显示编辑提示（延后调用，避免干扰焦点）
			setTimeout(() => {
				this.showEditingHint();
			}, 100);

		} catch (error) {
			this.showValidationError(this.messages.errors.enterEditModeFailed);
			this.exitEditMode();
		}
	}

	/**
	 * 退出编辑模式
	 */
	exitEditMode(): void {
		if (!this.editingState.isEditing) return;

		const { editElement, currentNode } = this.editingState;

		// 恢复画布交互
		this.setCanvasInteraction(true);

		if (editElement) {
			try {
				// 设置为不可编辑
				editElement.contentEditable = "false";
				editElement.classList.remove("editing");

				// 清除文本选区，防止退出编辑后文本仍保持选中状态
				const selection = window.getSelection();
				if (selection) {
					selection.removeAllRanges();
				}

				// 移除节点编辑状态
				const nodeElement = d3.select(editElement.closest("g"));
				nodeElement.classed("node-editing", false);
			} catch (error) {
				// Ignore errors when cleaning up DOM elements
			}
		}

		// 隐藏编辑提示
		this.hideEditingHint();

		// 重置编辑状态（清空属性，不重新赋值对象）
		this.editingState.isEditing = false;
		this.editingState.currentNode = null;
		this.editingState.originalText = '';
		this.editingState.editElement = null;
	}

	/**
	 * 取消编辑模式（恢复原始文本）
	 */
	cancelEdit(): void {
		if (!this.editingState.isEditing) return;

		const { editElement } = this.editingState;

		// 恢复原始文本
		if (editElement && this.editingState.originalText) {
			editElement.textContent = this.editingState.originalText;
		}

		// 调用 exitEditMode 进行清理
		// 由于文本已恢复，exitEditMode 中的保存检查会跳过（因为 currentText === originalText）
		this.exitEditMode();
	}

	/**
	 * 保存节点文本
	 */
	saveText(): void {

		if (!this.editingState.isEditing ||
			!this.editingState.currentNode ||
			!this.editingState.editElement) {
			return;
		}

		const { editElement, currentNode } = this.editingState;
		const newText = editElement.textContent?.trim() || '';


		try {
			// 验证新文本
			if (!this.validateText(newText)) {
				this.showValidationError(this.messages.errors.nodeTextEmpty);
				return;
			}

			// 检查文本是否真的有变化
			if (newText === this.editingState.originalText) {
				this.exitEditMode();
				return;
			}

			// 在修改前保存快照
			this.callbacks.onBeforeTextChange?.(currentNode);

			// 更新数据结构
			currentNode.data.text = newText;

			// 触发文件保存回调
			this.callbacks.onTextChanged?.(currentNode, newText);

		} catch (error) {
			this.showValidationError(this.messages.errors.saveFailed);
			// 恢复原始文本
			editElement.textContent = this.editingState.originalText;
		}

		this.exitEditMode();
	}

	/**
	 * 验证节点文本
	 *
	 * @param text 要验证的文本
	 * @returns 是否有效
	 */
	validateText(text: string): boolean {
		// 检查是否为空或只有空白字符
		if (!text || text.trim().length === 0) {
			return false;
		}

		// 检查长度限制（使用配置常量）
		if (text.length > VALIDATION_CONSTANTS.MAX_TEXT_LENGTH) {
			return false;
		}

		// 检查是否包含非法字符
		const invalidChars = VALIDATION_CONSTANTS.INVALID_CHARACTERS;
		if (invalidChars.some(char => text.includes(char))) {
			return false;
		}

		return true;
	}

	/**
	 * 获取当前编辑状态（只读）
	 * 注意：返回的是真实引用，用于 TextRenderer 等模块检查状态
	 */
	getEditingState(): Readonly<EditingState> {
		return this.editingState;
	}

	/**
	 * 是否正在编辑
	 */
	isEditing(): boolean {
		return this.editingState.isEditing;
	}

	/**
	 * 检查画布交互是否启用
	 */
	isCanvasInteractionEnabled(): boolean {
		return this.canvasInteractionEnabled;
	}

	/**
	 * 销毁
	 */
	destroy(): void {
		// 退出编辑模式（如果正在编辑）
		this.exitEditMode();
		// 隐藏编辑提示
		this.hideEditingHint();
	}

	// ========== 私有方法 ==========

	/**
	 * 设置画布交互状态
	 */
	private setCanvasInteraction(enabled: boolean): void {
		this.canvasInteractionEnabled = enabled;
		this.callbacks.onCanvasInteractionChanged?.(enabled);
	}

	/**
	 * 显示编辑提示
	 */
	private showEditingHint(): void {
		let hintElement = document.querySelector('.editing-hint');
		if (!hintElement) {
			hintElement = document.createElement('div');
			hintElement.className = 'editing-hint';
			// 根据设备类型选择不同的提示文案
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
	 * 隐藏编辑提示
	 */
	private hideEditingHint(): void {
		const hintElement = document.querySelector('.editing-hint');
		if (hintElement) {
			hintElement.classList.remove('show');
		}
	}

	/**
	 * 显示根节点编辑警告
	 */
	private showRootNodeEditWarning(): void {
		new Notice(this.messages.validation.cannotEditRoot, 3000);
	}

	/**
	 * 显示验证错误
	 */
	private showValidationError(message: string): void {
		// 创建临时的错误提示
		const errorElement = document.createElement('div');
		errorElement.className = 'mind-map-validation-error';
		errorElement.textContent = message;
		document.body.appendChild(errorElement);

		// 3秒后自动移除
		setTimeout(() => {
			errorElement.classList.add('fading-out');
			setTimeout(() => {
				if (errorElement.parentNode) {
					errorElement.parentNode.removeChild(errorElement);
				}
			}, 200);
		}, 3000);

		// 如果处于编辑状态，尝试恢复
		if (this.editingState.isEditing) {
			try {
				this.exitEditMode();
			} catch (recoveryError) {
				// Ignore errors during recovery attempt
			}
		}
	}
}
