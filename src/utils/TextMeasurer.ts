import { STYLE_CONSTANTS } from '../constants/mindmap-constants';
import { getFontSizeByDepth } from '../constants/mindmap-constants';
import { cleanTextContent } from './mindmap-utils';

/**
 * Helper function to set multiple CSS properties at once
 * This provides a cleaner alternative to direct style manipulation
 */
function setCssProps(element: HTMLElement, props: Record<string, string>): void {
	Object.assign(element.style, props);
}

/**
 * 节点尺寸配置接口
 */
export interface NodeDimensions {
	width: number;
	height: number;
	textX: number;
	textY: number;
	fontSize: string;
	fontWeight: string;
	lines: string[];
	padding: number;
	minWidth: number;
	maxWidth: number | null;
}

/**
 * 文本测量器
 *
 * 【职责】
 * 精确测量文本尺寸、处理文字换行、计算节点尺寸
 *
 * 【核心功能】
 * 1. 精确文本测量：使用隐藏的 DOM 元素精确测量文本尺寸
 * 2. 智能文字换行：根据最大宽度自动换行或保持单行
 * 3. 节点尺寸计算：根据节点深度和文本内容计算完整的节点尺寸配置
 * 4. 缓存优化：缓存测量结果以提升性能
 *
 * 【性能优化】
 * - textMeasurementCache: 文本测量结果缓存
 * - nodeDimensionsCache: 节点尺寸缓存
 * - 隐藏的 DOM 元素复用
 *
 * 【使用示例】
 * ```typescript
 * const measurer = new TextMeasurer();
 * const dimensions = measurer.getNodeDimensions(0, "中心主题");
 * measurer.destroy(); // 使用完毕后清理
 * ```
 */
export class TextMeasurer {
	// 文本测量元素（隐藏的 DOM 元素，用于精确测量）
	private textMeasurementElement: HTMLDivElement | null = null;

	// 文本测量缓存
	private textMeasurementCache = new Map<string, { width: number; height: number }>();

	// 节点尺寸缓存
	private nodeDimensionsCache = new Map<string, NodeDimensions>();

	/**
	 * 精确测量文本尺寸
	 *
	 * 使用隐藏的 DOM 元素精确测量文本的宽高，支持缓存
	 *
	 * @param text 要测量的文本
	 * @param fontSize 字体大小（像素）
	 * @param fontWeight 字体粗细（normal/bold等）
	 * @returns 文本的宽高尺寸
	 */
	public measureTextAccurately(text: string, fontSize: number, fontWeight: string = 'normal'): { width: number; height: number } {
		const cacheKey = `${text}-${fontSize}-${fontWeight}`;

		if (this.textMeasurementCache.has(cacheKey)) {
			const cached = this.textMeasurementCache.get(cacheKey);
			if (cached) {
				return cached;
			}
		}

		this.initializeTextMeasurementElement();

		if (this.textMeasurementElement) {
			setCssProps(this.textMeasurementElement, {
				fontSize: `${fontSize}px`,
				fontWeight: fontWeight
			});
			this.textMeasurementElement.textContent = text;

			const rect = this.textMeasurementElement.getBoundingClientRect();
			const result = {
				width: rect.width,
				height: rect.height
			};

			this.textMeasurementCache.set(cacheKey, result);
			return result;
		}

		// 降级到估算方法
		const charWidth = fontSize * 0.62;
		const lineHeight = fontSize * 1.2;
		return {
			width: text.length * charWidth,
			height: lineHeight
		};
	}

	/**
	 * 智能文字换行
	 *
	 * 根据最大宽度自动换行，或者保持单行显示
	 *
	 * @param text 原始文本
	 * @param maxWidth 最大宽度（null表示不限制宽度）
	 * @param fontSize 字体大小
	 * @returns 换行后的文本数组
	 */
	public wrapText(text: string, maxWidth: number | null, fontSize: number): string[] {
		if (!text || text.length === 0) return [""];

		// 如果maxWidth为null，表示允许单行显示，不进行自动换行
		if (maxWidth === null) {
			// 检查是否包含手动换行符
			if (text.includes('\n')) {
				const lines = text.split('\n');
				return lines;
			}
			return [text];
		}

		// 简单的字符宽度估算（可以根据需要优化）
		const charWidth = fontSize * 0.62; // 平衡的字符宽度估算
		const maxChars = Math.floor(maxWidth / charWidth);

		if (text.length <= maxChars) {
			return [text];
		}

		const words = text.split(' ');
		const lines: string[] = [];
		let currentLine = "";

		for (const word of words) {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			if (testLine.length <= maxChars) {
				currentLine = testLine;
			} else {
				if (currentLine) {
					lines.push(currentLine);
				}
				currentLine = word;
			}
		}

		if (currentLine) {
			lines.push(currentLine);
		}

		return lines.length > 0 ? lines : [text.substring(0, maxChars)];
	}

	/**
	 * 测量多行文本的尺寸（改进版）
	 *
	 * @param lines 文本行数组
	 * @param fontSize 字体大小
	 * @param fontWeight 字体粗细
	 * @returns 文本的总宽高
	 */
	public measureTextSize(lines: string[], fontSize: number, fontWeight: string = 'normal'): {
		width: number;
		height: number;
	} {
		if (lines.length === 0) {
			return { width: 40, height: fontSize * 1.3 }; // 降低最小宽度：60→40
		}

		const lineHeight = fontSize * 1.3; // 行高为字体大小的1.3倍（优化：1.5→1.3，节省13%）
		let maxWidth = 0;

		// 使用精确测量方法
		for (const line of lines) {
			const measurement = this.measureTextAccurately(line, fontSize, fontWeight);
			if (measurement.width > maxWidth) {
				maxWidth = measurement.width;
			}
		}

		const height = lines.length * lineHeight;
		const width = Math.max(maxWidth, 35); // 大幅降低最小宽度：60→35（约一个字符的宽度）

		const result = { width: Math.ceil(width), height: Math.ceil(height) };

		return result;
	}

	/**
	 * 获取节点尺寸配置（自适应版本）
	 *
	 * 根据节点深度和文本内容，计算节点的完整尺寸配置
	 * 包括宽度、高度、文本位置、字体样式等
	 *
	 * @param depth 节点深度（0=根节点，1=第一层，2+=其他层）
	 * @param text 节点文本内容
	 * @returns 节点尺寸配置对象
	 */
	public getNodeDimensions(depth: number, text: string): NodeDimensions {
		// 创建缓存键
		const cacheKey = `${depth}-${text}-${text.length}`;

		// 检查缓存
		if (this.nodeDimensionsCache.has(cacheKey)) {
			const cached = this.nodeDimensionsCache.get(cacheKey);
			if (cached) {
				return cached;
			}
		}
		const cleanedText = cleanTextContent(text);

		let fontSize: string;
		let fontWeight: string;
		let maxWidth: number | null;
		let minWidth: number;
		let padding: number;

		if (depth === 0) {
			// 根节点：增强样式
			fontSize = getFontSizeByDepth(0);
			fontWeight = "bold";
			maxWidth = null; // 移除宽度限制，允许动态调整
			minWidth = 40; // 大幅降低：70→40，允许单字符节点自适应（仅作为底线保护）
			padding = 18; // 优化：24→18，减少25%
		} else if (depth === 1) {
			// 第1层：增强样式
			fontSize = getFontSizeByDepth(1);
			fontWeight = "bold";
			maxWidth = null; // 移除宽度限制，允许动态调整
			minWidth = 38; // 大幅降低：65→38，允许单字符节点自适应
			padding = 16; // 优化：20→16，减少20%
		} else {
			// 第2层及以后：更紧凑的样式
			fontSize = getFontSizeByDepth(depth);
			fontWeight = "normal";
			maxWidth = null; // 移除宽度限制，允许动态调整
			minWidth = 20; // 极限压缩：35→20，最大化紧凑度
			padding = 10; // 优化：12→10，减少17%
		}

		const fontSizeNum = parseInt(fontSize);
		const effectiveMaxWidth = maxWidth !== null ? maxWidth - padding * 2 : null;
		const lines = this.wrapText(cleanedText, effectiveMaxWidth, fontSizeNum);
		const textSize = this.measureTextSize(lines, fontSizeNum, fontWeight);

		// 计算最终节点尺寸
		const safetyBuffer = Math.max(8, textSize.width * 0.05); // 至少8px或5%缓冲
		const width = Math.max(textSize.width + padding * 2 + safetyBuffer, minWidth);
		const height = Math.max(textSize.height + padding * 2, fontSizeNum * 2.0); // 最小高度为字体大小的2.0倍（优化：2.5→2.0，节省20%）

		// 计算文字位置（居中对齐）
		const textX = width / 2;
		const textY = textSize.height / 2 + padding / 2; // 修复垂直居中 // 微调Y位置

		const result: NodeDimensions = {
			width,
			height,
			textX,
			textY,
			fontSize,
			fontWeight,
			lines,
			padding,
			minWidth,
			maxWidth
		};

		// 缓存计算结果
		this.nodeDimensionsCache.set(cacheKey, result);

		return result;
	}

	/**
	 * 清除特定文本的缓存
	 *
	 * 当文本内容修改时，清除相关的缓存以避免使用过时的数据
	 *
	 * @param text 要清除缓存的文本
	 */
	public clearNodeDimensionsCacheForText(text: string): void {
		const keysToDelete: string[] = [];
		for (const key of this.nodeDimensionsCache.keys()) {
			if (key.includes(text)) {
				keysToDelete.push(key);
			}
		}
		keysToDelete.forEach(key => this.nodeDimensionsCache.delete(key));

		// 同时清除文本测量缓存
		const textKeysToDelete: string[] = [];
		for (const key of this.textMeasurementCache.keys()) {
			if (key.includes(text)) {
				textKeysToDelete.push(key);
			}
		}
		textKeysToDelete.forEach(key => this.textMeasurementCache.delete(key));
	}

	/**
	 * 初始化文本测量元素（私有方法）
	 *
	 * 创建一个隐藏的 DOM 元素用于精确测量文本尺寸
	 */
	private initializeTextMeasurementElement(): void {
		if (!this.textMeasurementElement) {
			this.textMeasurementElement = document.createElement('div');
			this.textMeasurementElement.addClass('mindmap-text-measurer');
			document.body.appendChild(this.textMeasurementElement);
		}
	}

	/**
	 * 销毁测量器，清理资源
	 *
	 * 清理隐藏的 DOM 元素和所有缓存
	 */
	public destroy(): void {
		// 清理文本测量元素
		if (this.textMeasurementElement && this.textMeasurementElement.parentNode) {
			this.textMeasurementElement.parentNode.removeChild(this.textMeasurementElement);
			this.textMeasurementElement = null;
		}

		// 清理缓存
		this.textMeasurementCache.clear();
		this.nodeDimensionsCache.clear();
	}
}
