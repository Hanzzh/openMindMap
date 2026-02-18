/**
 * Mind Map Plugin Interfaces
 *
 * Centralized interface definitions for the mind map plugin
 */

import { App, TFile } from 'obsidian';
import * as d3 from 'd3';

// ============================================================================
// Core Data Interfaces
// ============================================================================

/**
 * Plugin settings interface
 */
export interface MindMapSettings {
    deviceType: 'auto' | 'desktop' | 'mobile';
}

/**
 * Mind map node structure
 */
export interface MindMapNode {
    text: string;              // 结点显示文本
    level: number;             // 层级深度（0为根节点）
    parent: MindMapNode | null; // 直接父节点引用
    children: MindMapNode[];   // 直接子节点数组
    color?: string;            // 节点颜色
    icon?: string;             // 节点图标
    link?: string;             // 链接地址
    expanded: boolean;         // 是否展开
    selected?: boolean;        // 是否选中
    hovered?: boolean;         // 是否悬停（待选中状态）
    // 递归布局相关字段
    x?: number;                // 节点X坐标
    y?: number;                // 节点Y坐标
    nodeWidth?: number;        // 节点自身宽度
    nodeHeight?: number;       // 节点自身高度
    subtreeWidth?: number;     // 子树总宽度（包含所有子节点）
    subtreeHeight?: number;    // 子树总高度（包含所有子节点）
}

/**
 * Complete mind map data structure
 */
export interface MindMapData {
    rootNode: MindMapNode | null;  // 唯一根节点
    allNodes: MindMapNode[];       // 扁平节点数组（用于查找）
    maxLevel: number;              // 最大层级深度
}

// ============================================================================
// Rendering Interfaces
// ============================================================================

/**
 * Node position information for layout
 */
export interface NodePosition {
    node: MindMapNode;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Mind map renderer interface
 */
export interface MindMapRenderer {
    render(container: Element, data: MindMapData): void;
    destroy(): void;
    onTextChanged?: (node: d3.HierarchyNode<MindMapNode>, newText: string) => void;
    onDataUpdated?: () => void;
    onDataRestored?: (data: MindMapData) => void;  // 当 undo/redo 恢复数据时调用
}

/**
 * Node editing state
 */
export interface EditingState {
    isEditing: boolean;
    currentNode: d3.HierarchyNode<MindMapNode> | null;
    originalText: string;
    editElement: HTMLDivElement | null;
}

// ============================================================================
// Layout Interfaces
// ============================================================================

/**
 * Node dimensions for layout calculation
 */
export interface NodeDimensions {
    width: number;
    height: number;
    fontSize: string;
    padding: number;
}

/**
 * Layout node with position information
 */
export interface LayoutNode {
    text: string;
    depth: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Tree layout result
 */
export interface TreeLayoutResult {
    nodes: LayoutNode[];
}

/**
 * Subtree dimensions for recursive layout calculation
 * Contains the total dimensions of a node including all its descendants
 */
export interface SubtreeDimensions {
    totalWidth: number;        // 子树总宽度（节点自身 + 所有子节点）
    totalHeight: number;       // 子树总高度（节点自身 + 所有子节点）
    nodeWidth: number;         // 节点自身宽度
    nodeHeight: number;        // 节点自身高度
    depth: number;             // 节点深度
    isLeaf: boolean;           // 是否为叶子节点
    childCount: number;        // 子节点数量
}

/**
 * Overlap information for collision detection
 */
export interface Overlap {
    node1: LayoutNode;
    node2: LayoutNode;
    overlapArea: number;
    overlapWidth: number;
    overlapHeight: number;
}

// ============================================================================
// Handler Interfaces
// ============================================================================

/**
 * File handler interface for mind map file operations
 */
export interface MindMapFileHandler {
    isMindMapFile(file: TFile): Promise<boolean>;
    loadFileContent(file: TFile): Promise<string>;
    parseMarkdownToNodes(content: string): MindMapNode[];
}

/**
 * State handler interface for view state management
 */
export interface MindMapStateHandler {
    getViewState(): {
        file: string | null;
        zoomTransform?: d3.ZoomTransform;
        scrollPosition?: { x: number; y: number };
    };
    setViewState(state: {
        file: string | null;
        zoomTransform?: d3.ZoomTransform;
        scrollPosition?: { x: number; y: number };
    }): Promise<void>;
    isStateLoaded(): boolean;
}

/**
 * Interaction handler interface for user interactions
 */
export interface MindMapInteractionHandler {
    handleNodeClick(event: MouseEvent, node: d3.HierarchyNode<MindMapNode>, nodeRect: d3.Selection<SVGRectElement, unknown, null, undefined>): void;
    handleNodeDoubleClick(node: d3.HierarchyNode<MindMapNode>): void;
    handleCanvasClick(event: MouseEvent): void;
    handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void;
}

// ============================================================================
// Plugin Component Interfaces
// ============================================================================

/**
 * Plugin lifecycle interface
 */
export interface MindMapPluginLifecycle {
    onload(): Promise<void>;
    onunload(): void;
    loadSettings(): Promise<void>;
    saveSettings(): Promise<void>;
}

/**
 * View management interface
 */
export interface MindMapViewManager {
    activateView(): Promise<void>;
    replaceWithMindMapView(file: TFile): Promise<void>;
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
}