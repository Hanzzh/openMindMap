/**
 * Mind Map Utility Functions
 *
 * Pure utility functions for mind map processing
 */

import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { MINDMAP_IDENTIFIER, MARKDOWN_EXTENSION, VALIDATION_CONSTANTS } from '../constants/mindmap-constants';

// ============================================================================
// Text Processing Utilities
// ============================================================================

/**
 * Clean text content by removing attributes while preserving original whitespace
 * Preserves newlines and original spacing for multi-line text support
 */
export function cleanTextContent(text: string): string {
    if (!text) return "";

    return text
        .replace(/\[([a-zA-Z_][a-zA-Z0-9_]*:[^\]]+)\]/g, '') // 移除[key:value]格式的属性
        .trim(); // 移除首尾空格
}

/**
 * Wrap text intelligently based on max width and font size
 */
export function wrapText(text: string, maxWidth: number | null, fontSize: number): string[] {
    if (!text || text.length === 0) return [""];

    // 如果maxWidth为null，表示允许单行显示，不进行换行
    if (maxWidth === null) {
        return [text];
    }

    // 字符宽度估算
    const charWidth = fontSize * 0.62; // 平衡的字符宽度估算
    const maxChars = Math.floor(maxWidth / charWidth);

    if (text.length <= maxChars) {
        return [text];
    }

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (testLine.length <= maxChars) {
            currentLine = testLine;
        } else {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                // 单个单词太长，强制分割
                lines.push(word.substring(0, maxChars));
                currentLine = word.substring(maxChars);
            }
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text];
}

/**
 * Measure text dimensions based on lines and font properties
 */
export function measureTextSize(lines: string[], fontSize: number, fontWeight: string = 'normal'): {
    width: number;
    height: number;
} {
    if (lines.length === 0) {
        return { width: 60, height: fontSize * 1.2 };
    }

    const lineHeight = fontSize * 1.2; // 行高为字体大小的1.2倍
    let maxWidth = 0;

    // 计算最长行的宽度
    for (const line of lines) {
        const lineWidth = lines.length === 1 ? line.length * fontSize * 0.6 : line.length * fontSize * 0.5;
        maxWidth = Math.max(maxWidth, lineWidth);
    }

    return {
        width: maxWidth,
        height: lines.length * lineHeight
    };
}

/**
 * Get file name without extension from file path
 */
export function getFileNameWithoutExtension(filePath: string): string {
    if (!filePath) return 'Untitled';

    // Remove path and keep only filename, then remove .md extension
    const fileName = filePath.replace(/^.*[\\\/]/, '');
    return fileName.replace(/\.md$/, '');
}

// ============================================================================
// Markdown Parsing Utilities
// ============================================================================

/**
 * Check if a line is a markdown list item
 * Requires list marker to be present (not optional)
 */
export function isListItem(line: string): boolean {
    return /^[ \t]*[*\-+]\s+\S/.test(line) || /^[ \t]*\d+\.\s+\S/.test(line);
}

/**
 * Parse a single markdown list item
 */
export function parseListItem(line: string): { level: number; content: string; indent: string } | null {
    const match = line.match(/^(\s*)([*\-+]?\d*\.?)\s+(.+)$/);
    if (!match) return null;

    const [, indent, , content] = match;
    const level = Math.floor(indent.length / 4); // 4 spaces = 1 level

    return {
        level,
        content: cleanTextContent(content),
        indent
    };
}

/**
 * Generate markdown content from mind map nodes
 * Supports multi-line text with proper continuation line indentation
 */
export function generateMarkdownFromNodes(rootNode: MindMapNode): string {
    let markdown = MINDMAP_IDENTIFIER + "\n\n";

    // 递归生成子节点的markdown
    const generateNodeMarkdown = (node: MindMapNode, indentLevel: number): void => {
        if (node.level === 0) return; // 跳过根节点（文件名）

        const indent = "    ".repeat(indentLevel - 1); // level 1 缩进 0，level 2 缩进 4空格，以此类推
        const listPrefix = "*"; // 使用 * 作为列表符号

        // 分割多行文本
        const lines = node.text.split('\n');
        markdown += `${indent}${listPrefix} ${lines[0]}\n`;

        // 输出续行，续行缩进 = 列表缩进 + 2空格（对应`* `）
        const continuationIndent = indent + "  ";
        for (let i = 1; i < lines.length; i++) {
            markdown += `${continuationIndent}${lines[i]}\n`;
        }

        // 递归处理子节点
        for (const child of node.children) {
            generateNodeMarkdown(child, indentLevel + 1);
        }
    };

    // 生成所有子节点的markdown
    for (const child of rootNode.children) {
        generateNodeMarkdown(child, child.level);
    }

    return markdown;
}

/**
 * Parse markdown content to mind map data
 * Supports multi-line text with continuation lines
 */
export function parseMarkdownContent(content: string, filePath: string): {
    rootNode: MindMapNode | null;
    allNodes: MindMapNode[];
    maxLevel: number;
} {
    // Remove #mindmap identifier and split by lines
    const lines = content.replace(/^#mindmap\s*\n?/, '').split('\n');

    // Initialize data structures
    const allNodes: MindMapNode[] = [];
    const nodeStack: (MindMapNode | null)[] = []; // Parent node stack
    let maxLevel = 0;
    let rootNode: MindMapNode | null = null;
    let lastNode: MindMapNode | null = null; // 跟踪最后一个节点
    let lastIndentLength = 0; // 最后一个列表项的缩进长度

    // 1. 创建文件名根结点 (level=0)
    const fileName = getFileNameWithoutExtension(filePath);
    rootNode = {
        text: fileName,
        level: 0,
        parent: null,
        children: [],
        expanded: true
    };
    allNodes.push(rootNode);
    nodeStack.push(rootNode);

    // 2. 解析 markdown 列表项和续行
    for (const line of lines) {
        if (!line.trim()) continue; // 跳过空行

        if (isListItem(line)) {
            // 处理列表项
            const parsed = parseListItem(line);
            if (!parsed) continue;

            const { level, content, indent } = parsed;

            // 3. 创建新节点
            const newNode: MindMapNode = {
                text: content,
                level: level + 1, // +1 因为根节点是 level 0
                parent: null,
                children: [],
                expanded: true
            };

            // 4. 找到合适的父节点
            while (nodeStack.length > level + 1) {
                nodeStack.pop();
            }

            const parentNode = nodeStack[nodeStack.length - 1];
            if (parentNode) {
                newNode.parent = parentNode;
                parentNode.children.push(newNode);
            }

            allNodes.push(newNode);
            nodeStack.push(newNode);
            lastNode = newNode;
            lastIndentLength = indent.length;
            maxLevel = Math.max(maxLevel, newNode.level);
        } else {
            // 处理续行（非列表项）
            const currentIndent = line.match(/^\s*/)?.[0].length || 0;

            // 续行条件：缩进比上一列表项更深即可
            if (lastNode && currentIndent > lastIndentLength) {
                const lineContent = line.trim();
                if (lineContent) {
                    lastNode.text = lastNode.text + '\n' + lineContent;
                }
                continue; // 重要：跳过后续处理，防止被当作新节点
            }
            // 否则忽略（可能是格式错误的内容）
        }
    }

    return {
        rootNode,
        allNodes,
        maxLevel
    };
}

// ============================================================================
// Node Validation Utilities
// ============================================================================

/**
 * Validate node text content
 */
export function validateNodeText(text: string): boolean {
    // 检查是否为空或只有空白字符
    if (!text || text.trim().length === 0) {
        return false;
    }

    // 检查长度限制
    if (text.length > VALIDATION_CONSTANTS.MAX_TEXT_LENGTH) {
        return false;
    }

    // 检查无效字符
    for (const char of VALIDATION_CONSTANTS.INVALID_CHARACTERS) {
        if (text.includes(char)) {
            return false;
        }
    }

    return true;
}

/**
 * Sanitize text for node display
 */
export function sanitizeNodeText(text: string): string {
    return text
        .trim()
        .substring(0, VALIDATION_CONSTANTS.MAX_TEXT_LENGTH)
        .replace(new RegExp(`[${VALIDATION_CONSTANTS.INVALID_CHARACTERS.join('')}]`, 'g'), '');
}

// ============================================================================
// File Detection Utilities
// ============================================================================

/**
 * Check if a file is a mind map file
 */
export function isMindMapFile(content: string, extension: string): boolean {
    return extension === MARKDOWN_EXTENSION &&
           content.trim().startsWith(MINDMAP_IDENTIFIER);
}

// ============================================================================
// Node Relationship Utilities
// ============================================================================

/**
 * Find all descendants of a node
 */
export function getNodeDescendants(node: MindMapNode): MindMapNode[] {
    const descendants: MindMapNode[] = [];

    for (const child of node.children) {
        descendants.push(child);
        descendants.push(...getNodeDescendants(child));
    }

    return descendants;
}

/**
 * Find all ancestors of a node
 */
export function getNodeAncestors(node: MindMapNode): MindMapNode[] {
    const ancestors: MindMapNode[] = [];
    let current = node.parent;

    while (current) {
        ancestors.push(current);
        current = current.parent;
    }

    return ancestors;
}

/**
 * Check if two nodes have a parent-child relationship
 */
export function isNodeDescendant(parent: MindMapNode, child: MindMapNode): boolean {
    if (parent.children.includes(child)) {
        return true;
    }

    for (const grandChild of parent.children) {
        if (isNodeDescendant(grandChild, child)) {
            return true;
        }
    }

    return false;
}

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Debounce function for performance optimization
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }

        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}

/**
 * Throttle function for performance optimization
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean = false;

    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
            }, limit);
        }
    };
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Get node color based on level
 */
export function getNodeColor(level: number, depth: number): string {
    // Simple color mapping based on level and depth
    const hue = (level * 30 + depth * 15) % 360;
    const saturation = Math.max(40, 70 - level * 5);
    const lightness = Math.max(30, 60 - level * 3);

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Generate contrasting text color for background
 */
export function getContrastTextColor(backgroundColor: string): string {
    // Simple implementation - in production, use a proper color contrast library
    return backgroundColor.includes('hsl(') && backgroundColor.includes('50%') ? '#000' : '#fff';
}