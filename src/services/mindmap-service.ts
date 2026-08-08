/**
 * Mind Map Service
 *
 * Central coordination service for mind map functionality
 * Provides high-level API and coordinates between different modules
 */

import { App, Notice, TFile } from 'obsidian';
import { MindMapData, MindMapNode } from '../interfaces/mindmap-interfaces';
import { D3FileHandler } from '../handlers/file-handler';
import { LayoutCalculator } from '../renderers/layout-calculator';
import { parseMarkdownContent, generateMarkdownFromNodes } from '../utils/mindmap-utils';
import { MindMapConfig } from '../config/types';
import { AIClient, NodeContext } from '../utils/ai-client';
import { MindMapSettings } from '../main';
import { createI18nManager } from '../i18n';
import type { MindMapMessages } from '../i18n';

/**
 * Mind Map Service - coordinates all mind map operations
 */
export class MindMapService {
    private app: App;
    private fileHandler: D3FileHandler;
    private layoutCalculator: LayoutCalculator;
    private config: MindMapConfig;
    private settings?: MindMapSettings;
    private aiClient?: AIClient;
    private messages: MindMapMessages;

    constructor(app: App, config: MindMapConfig, settings?: MindMapSettings, aiClient?: AIClient) {
        // Store app instance for showing notices
        this.app = app;

        // Phase 1: Store config for future use
        this.config = config;
        this.settings = settings;
        this.aiClient = aiClient;

        // Initialize i18n with language from config or settings
        const language = config.language || settings?.language || 'en';
        const i18nManager = createI18nManager(language);
        this.messages = i18nManager.getMessages();

        // Initialize handlers and calculators (Phase 1: no config usage yet)
        this.fileHandler = new D3FileHandler(app);
        this.layoutCalculator = new LayoutCalculator();

        // TODO: Phase 2 - Pass config to handlers for device-specific behavior
        // this.fileHandler = new D3FileHandler(app, config);
        // this.layoutCalculator = new LayoutCalculator(config);
    }

    /**
     * Update settings and AI client
     */
    updateSettings(settings: MindMapSettings, aiClient: AIClient) {
        this.settings = settings;
        this.aiClient = aiClient;
    }

    /**
     * Update language when user changes settings
     */
    updateLanguage(language: 'en' | 'zh'): void {
        const i18nManager = createI18nManager(language);
        this.messages = i18nManager.getMessages();
    }

    /**
     * Check if a file should be displayed as a mind map
     */
    async isMindMapFile(file: TFile): Promise<boolean> {
        return this.fileHandler.isMindMapFile(file);
    }

    /**
     * Load and parse mind map data from a file
     */
    async loadMindMapData(file: TFile): Promise<MindMapData> {
        const content = await this.fileHandler.loadFileContent(file);
        return this.fileHandler.parseMarkdownToData(content, file.path);
    }

    /**
     * Save mind map data to a file
     */
    async saveMindMapData(filePath: string, rootNode: MindMapNode): Promise<void> {
        await this.fileHandler.saveToMarkdownFile(filePath, rootNode);
    }

    /**
     * Save mind map data to markdown file (alias for saveMindMapData)
     */
    async saveToMarkdownFile(filePath: string, rootNode: MindMapNode): Promise<void> {
        await this.fileHandler.saveToMarkdownFile(filePath, rootNode);
    }

    /**
     * Parse markdown content to mind map nodes
     */
    parseMarkdownToNodes(content: string): MindMapNode[] {
        return this.fileHandler.parseMarkdownToNodes(content);
    }

    /**
     * Parse markdown content to complete mind map data
     */
    parseMarkdownToData(content: string, filePath: string): MindMapData {
        return parseMarkdownContent(content, filePath);
    }

    /**
     * Generate markdown content from nodes
     */
    generateMarkdownFromNodes(rootNode: MindMapNode): string {
        return generateMarkdownFromNodes(rootNode);
    }

    /**
     * Get layout calculator
     */
    getLayoutCalculator(): LayoutCalculator {
        return this.layoutCalculator;
    }

    /**
     * Get file handler
     */
    getFileHandler(): D3FileHandler {
        return this.fileHandler;
    }

    /**
     * Create a new mind map file
     */
    async createMindMapFile(filePath: string, title: string): Promise<TFile> {
        return this.fileHandler.createMindMapFile(filePath, title);
    }

    /**
     * Check if file exists
     */
    fileExists(filePath: string): boolean {
        return this.fileHandler.fileExists(filePath);
    }

    /**
     * Create a new child node for the given parent node
     *
     * Auto-expands the parent so the new child is visible. This single
     * point covers all callers: Tab key / plus button, AI suggestions,
     * and paste.
     */
    createChildNode(parentNode: MindMapNode, childText = "New Node"): MindMapNode {
        const childNode: MindMapNode = {
            text: childText,
            level: parentNode.level + 1,
            parent: parentNode,
            children: [],
            expanded: true,
            selected: false,
            hovered: false
        };

        parentNode.children.push(childNode);

        // 自动展开父节点，否则新子节点不可见且无法进入编辑模式
        parentNode.expanded = true;

        return childNode;
    }

    /**
     * Create a new sibling node after the given node
     * (at the same level, with the same parent)
     */
    createSiblingNode(afterNode: MindMapNode, siblingText = "New Node"): MindMapNode | null {
        // Cannot create sibling for root node
        if (!afterNode.parent) {
            return null;
        }

        const siblingNode: MindMapNode = {
            text: siblingText,
            level: afterNode.level,  // Same level as sibling
            parent: afterNode.parent,
            children: [],
            expanded: true,
            selected: false,
            hovered: false
        };

        // Find the index of the current node in parent's children array
        const parent = afterNode.parent;
        const childIndex = parent.children.indexOf(afterNode);

        // Insert the new sibling after the current node
        parent.children.splice(childIndex + 1, 0, siblingNode);

        return siblingNode;
    }

    /**
     * Delete a node and all its children recursively
     */
    deleteNode(nodeToDelete: MindMapNode): boolean {
        if (!nodeToDelete) {
            return false;
        }

        // 不能删除根节点
        if (nodeToDelete.level === 0) {
            new Notice(`⚠️ ${this.messages.notices.cannotDeleteRoot}`, 3000);
            return false;
        }

        const parent = nodeToDelete.parent;
        if (!parent) {
            new Notice(`⚠️ ${this.messages.notices.cannotDeleteNoParent}`, 3000);
            return false;
        }

        // 从父节点的children数组中移除该节点
        const childIndex = parent.children.indexOf(nodeToDelete);
        if (childIndex !== -1) {
            parent.children.splice(childIndex, 1);
            return true;
        }

        return false;
    }

    /**
     * Get all descendants of a node (including the node itself)
     */
    private getAllDescendants(node: MindMapNode): MindMapNode[] {
        const descendants: MindMapNode[] = [node];

        const collectDescendants = (currentNode: MindMapNode) => {
            for (const child of currentNode.children) {
                descendants.push(child);
                collectDescendants(child);
            }
        };

        collectDescendants(node);
        return descendants;
    }

    /**
     * Update the allNodes array after deletion
     */
    updateAllNodesArray(rootNode: MindMapNode): MindMapNode[] {
        const allNodes: MindMapNode[] = [];

        const buildArray = (node: MindMapNode): void => {
            allNodes.push(node);
            node.children.forEach(buildArray);
        };

        buildArray(rootNode);
        return allNodes;
    }

    /**
     * Suggest child nodes for a given node using AI
     * @param node The parent node
     * @returns Array of suggestions
     */
    async suggestChildNodes(node: MindMapNode): Promise<string[]> {
        if (!this.aiClient || !this.settings) {
            throw new Error('AI client or settings not configured');
        }


        // Collect context information
        const context: NodeContext = {
            nodeText: node.text,
            level: node.level,
            parent: node.parent?.text,
            siblings: node.parent?.children
                .filter(c => c !== node)
                .map(c => c.text),
            existingChildren: node.children.map(c => c.text),
            centralTopic: this.getCentralTopic(node)
        };


        // Get prompt template from settings
        const promptTemplate = this.settings.aiPromptTemplate;
        const systemMessage = this.settings.aiSystemMessage;


        // Call AI client
        const suggestions = await this.aiClient.suggestChildNodes(context, promptTemplate, systemMessage);


        return suggestions;
    }

    /**
     * Get the AI client
     */
    getAIClient(): AIClient | undefined {
        return this.aiClient;
    }

    /**
     * Get central topic (root node text) from any node
     * @param node Any node in the mind map
     * @returns Root node text (central topic)
     */
    private getCentralTopic(node: MindMapNode): string {
        let current = node;
        while (current.parent !== null) {
            current = current.parent;
        }
        return current.text;
    }

    /**
     * 将子树序列化为markdown文本格式
     * @param rootNode 子树的根节点
     * @returns markdown格式的文本
     */
    serializeSubtreeToMarkdown(rootNode: MindMapNode): string {
        const lines: string[] = [];

        function traverse(node: MindMapNode, depth: number) {
            // 生成缩进(4个空格 * (depth - 1))
            const indent = '    '.repeat(depth - 1);
            // 生成markdown行
            lines.push(`${indent}* ${node.text}`);

            // 递归处理子节点
            node.children.forEach(child => traverse(child, depth + 1));
        }

        traverse(rootNode, 1);
        return lines.join('\n');
    }

    /**
     * 从markdown文本创建子树
     * @param markdown markdown格式的文本
     * @param parentLevel 父节点的层级
     * @returns 子树的根节点,如果解析失败返回null
     */
    createSubtreeFromMarkdown(markdown: string, parentLevel: number): MindMapNode | null {
        const lines = markdown.split('\n').filter(line => line.trim().length > 0);
        if (lines.length === 0) return null;

        let rootNode: MindMapNode | null = null;
        const stack: { node: MindMapNode; level: number }[] = [];

        for (const line of lines) {
            // 计算当前行的缩进级别
            const indent = line.search(/\S/);
            const level = Math.floor(indent / 4) + 1;
            const text = line.trim().substring(1).trim(); // 移除 '*'

            const newNode: MindMapNode = {
                text: text,
                level: parentLevel + level,
                parent: null,
                children: [],
                expanded: true,
                selected: false,
                hovered: false
            };

            // 找到父节点
            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }

            if (stack.length > 0) {
                const parent = stack[stack.length - 1].node;
                parent.children.push(newNode);
                newNode.parent = parent;
            } else {
                rootNode = newNode;
            }

            stack.push({ node: newNode, level });
        }

        return rootNode;
    }
}