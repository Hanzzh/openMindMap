import * as d3 from 'd3';
import { MindMapNode, NodeDimensions } from '../../interfaces/mindmap-interfaces';
import { TextMeasurer } from '../../utils/TextMeasurer';
import { MindMapConfig } from '../../config/types';
import { EditingState } from '../../interfaces/mindmap-interfaces';

/**
 * 文本渲染器
 *
 * 【职责】
 * - 创建foreignObject容器
 * - 渲染节点文本内容
 * - 处理多行文本
 * - 应用文本样式（font-size, padding, alignment）
 * - 处理文本编辑相关事件（blur, keydown, keyup）
 *
 * 【依赖】
 * - TextMeasurer: 获取尺寸信息
 * - MindMapConfig: 设备类型判断（移动端Enter行为不同）
 *
 * 【事件处理】
 * - keydown: Enter保存/Escape取消/Backspace处理换行
 * - keyup: Alt+Enter插入换行
 * - blur: 自动保存
 * - click: 阻止事件冒泡
 */
export class TextRenderer {
	constructor(
		private textMeasurer: TextMeasurer,
		private config?: MindMapConfig,
		private editingState?: EditingState,
		private onTextEdit?: (
			event: KeyboardEvent,
			textDivNode: HTMLDivElement,
			self: TextRenderer
		) => void
	) {}

	/**
	 * 为节点渲染文本
	 *
	 * @param nodeElements 节点元素选择
	 * @param onEditCallback 编辑事件回调函数
	 * @param parentContext 父级上下文（用于访问saveNodeText等方法）
	 */
	renderText(
		nodeElements: d3.Selection<SVGGElement, d3.HierarchyNode<MindMapNode>, SVGGElement, unknown>,
		onEditCallback?: (event: KeyboardEvent, textDivNode: HTMLDivElement) => void,
		parentContext?: {
			config?: MindMapConfig;
			editingState?: EditingState;
			saveNodeText?: () => void;
			cancelEditMode?: () => void;
			textMeasurer?: TextMeasurer;
		}
	): void {
		const self = parentContext || this;

		nodeElements.each(function(d) {
			const dimensions = (self as TextRenderer).textMeasurer.getNodeDimensions(d.depth, d.data.text);
			const nodeElement = d3.select(this);

			// 根据层级设置对齐方式
			const isCenterAligned = d.depth === 0 || d.depth === 1;

			// 创建统一的文本容器 - 同时用于显示和编辑
			const textForeignObject = nodeElement.append("foreignObject")
				.attr("class", "node-text-layer")
				.attr("width", dimensions.width)
				.attr("height", dimensions.height)
				.attr("x", 0)
				.attr("y", 0);

			const textDiv = textForeignObject.append("xhtml:div")
				.attr("contenteditable", "false")  // 默认不可编辑
				.attr("class", "node-unified-text")
				.style("width", "100%")
				.style("height", "100%")
				.style("padding", `${dimensions.padding}px`)
				.style("font-size", dimensions.fontSize)
				.style("font-weight", dimensions.fontWeight)
				.style("color", d.depth === 0 ? "#ffffff" : "#000000")
				.style("text-align", isCenterAligned ? "center" : "left")
				.style("outline", "none")
				.style("border", "none")
				.style("background", "transparent")
				.style("word-wrap", "normal")       // 禁用自动换行
				.style("white-space", "pre")         // 只保留手动换行，禁用自动换行
				.style("overflow", "visible")
				.style("box-sizing", "border-box")
				.style("font-family", "var(--font-text)")
				.style("line-height", "1.3")        // 优化：1.5→1.3，节省13%
				.style("cursor", "pointer");  // 默认指针样式
				// user-select 由 CSS 的 .editing 类控制，不需要在这里设置

			// 设置文本内容
			const textDivNode = textDiv.node() as HTMLDivElement;
			if (textDivNode) {
				textDivNode.textContent = d.data.text;

				// 为节点添加唯一class以便后续查找
				const nodeTextClass = `node-${d.data.text.replace(/\s+/g, '-')}`;
				nodeElement.classed(nodeTextClass, true);

				// 附加事件处理器（使用 TextRenderer 实例）
				if (parentContext && parentContext instanceof Object) {
					// 如果是 D3TreeRenderer 实例，直接附加事件
					TextRenderer.attachTextEditHandlersToNode(textDivNode, d, onEditCallback, self as {
						config?: MindMapConfig;
						editingState?: EditingState;
						saveNodeText?: () => void;
						cancelEditMode?: () => void;
					});
				}
			} else {
			}
		});
	}

	/**
	 * 添加文本编辑事件处理器（静态方法）
	 *
	 * @param textDivNode 文本div元素
	 * @param nodeData 节点数据
	 * @param onEditCallback 编辑回调函数
	 * @param parentContext 父级上下文（D3TreeRenderer实例）
	 */
	static attachTextEditHandlersToNode(
		textDivNode: HTMLDivElement,
		nodeData: d3.HierarchyNode<MindMapNode>,
		onEditCallback?: (event: KeyboardEvent, textDivNode: HTMLDivElement) => void,
		parentContext?: {
			config?: MindMapConfig;
			editingState?: EditingState;
			saveNodeText?: () => void;
			cancelEditMode?: () => void;
		}
	): void {
		if (!parentContext) {
			return;
		}

		const config = parentContext.config;
		const editingState = parentContext.editingState;

		// keydown: Enter保存/Escape取消/Backspace处理换行
		textDivNode.addEventListener("keydown", (event) => {
			if (textDivNode.contentEditable === "true") {
				if (event.key === "Enter") {
					// 移动端：Enter 键主动插入换行符（不依赖默认行为）
					if (config?.isMobile) {
						event.preventDefault();
						event.stopPropagation();

						// 使用 Selection API 插入换行符（与 Alt+Enter 逻辑相同）
						const selection = window.getSelection();
						if (selection && selection.rangeCount > 0) {
							const range = selection.getRangeAt(0);

							// 删除选中的文本（如果有）
							range.deleteContents();

							// 创建文本节点，包含换行符
							const textNode = document.createTextNode('\n');
							range.insertNode(textNode);

							// 移动光标到换行符后面
							range.setStartAfter(textNode);
							range.setEndAfter(textNode);
							selection.removeAllRanges();
							selection.addRange(range);
						}
						return;
					}

					// 桌面端：保持原有逻辑
					if (event.altKey) {
						// Alt+Enter: 阻止默认行为，由 keyup 处理
						event.preventDefault();
						event.stopPropagation();
					} else {
						// Enter: 保存编辑
						event.preventDefault();
						event.stopPropagation();  // 阻止事件冒泡到全局监听器
						parentContext.saveNodeText?.();
					}
				} else if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();  // 阻止事件冒泡到全局监听器
					parentContext.cancelEditMode?.();  // 取消编辑,恢复原始文本
				} else if (event.key === "Backspace") {
					// 处理行首删除：检测光标是否在行首（前面有\n）
					const selection = window.getSelection();
					if (selection && selection.rangeCount > 0) {
						const range = selection.getRangeAt(0);
						const node = range.startContainer;

						// 检查是否在文本节点中
						if (node.nodeType === Node.TEXT_NODE) {
							const textContent = node.textContent || '';
							// 如果光标不在开头，且前一个字符是\n
							if (range.startOffset > 0 && textContent[range.startOffset - 1] === '\n') {
								event.preventDefault();
								event.stopPropagation();
								// 删除\n，合并到上一行
								range.setStart(node, range.startOffset - 1);
								range.deleteContents();
							}
						}
					}
				}

				// 触发自定义回调
				if (onEditCallback) {
					onEditCallback(event, textDivNode);
				}
			}
		});

		// keyup: Alt+Enter插入换行（避免与 contentEditable 默认行为冲突）
		textDivNode.addEventListener("keyup", (event) => {
			if (textDivNode.contentEditable === "true") {
				// 检测 Alt+Enter 组合键
				if (event.key === "Enter" && event.altKey) {
					// 使用 Selection API 插入换行符
					const selection = window.getSelection();
					if (selection && selection.rangeCount > 0) {
						const range = selection.getRangeAt(0);

						// 删除选中的文本（如果有）
						range.deleteContents();

						// 创建文本节点，包含换行符
						const textNode = document.createTextNode('\n');
						range.insertNode(textNode);

						// 移动光标到换行符后面
						range.setStartAfter(textNode);
						range.setEndAfter(textNode);
						selection.removeAllRanges();
						selection.addRange(range);
					}
				}
			}
		});

		// blur: 自动保存
		textDivNode.addEventListener("blur", () => {
			if (textDivNode.contentEditable === "true" && editingState?.editElement === textDivNode) {

				// 延迟保存，给点击其他元素留出时间
				setTimeout(() => {
					if (editingState?.editElement === textDivNode) {
						parentContext.saveNodeText?.();
					}
				}, 150);
			}
		});
	}

	/**
	 * 更新节点编辑状态的引用
	 *
	 * @param editingState 新的编辑状态
	 */
	updateEditingState(editingState: EditingState): void {
		this.editingState = editingState;
	}

	/**
	 * 更新父级上下文
	 *
	 * @param parentContext 新的父级上下文
	 */
	updateParentContext(parentContext: { config?: MindMapConfig; editingState?: EditingState }): void {
		this.onTextEdit = ((event: KeyboardEvent, textDivNode: HTMLDivElement) => {
			// 可以在这里添加自定义处理逻辑
		}) as (event: KeyboardEvent, textDivNode: HTMLDivElement, self: TextRenderer) => void;
	}
}
