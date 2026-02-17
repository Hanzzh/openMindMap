/**
 * Mind Map File Handler
 *
 * Handles file operations for mind map functionality
 */

import { TFile, App } from 'obsidian';
import { MindMapFileHandler, MindMapData, MindMapNode } from '../interfaces/mindmap-interfaces';
import { parseMarkdownContent, generateMarkdownFromNodes, isMindMapFile } from '../utils/mindmap-utils';

/**
 * Implementation of MindMapFileHandler
 */
export class D3FileHandler implements MindMapFileHandler {
    constructor(private app: App) {}

    /**
     * Check if a file should be displayed as a mind map
     */
    async isMindMapFile(file: TFile): Promise<boolean> {
        if (file.extension !== 'md') {
            return false;
        }

        try {
            const content = await this.app.vault.read(file);
            return isMindMapFile(content, file.extension);
        } catch (error) {
            console.error('Failed to check if file is mind map:', file.path, error);
            return false;
        }
    }

    /**
     * Load file content
     */
    async loadFileContent(file: TFile): Promise<string> {
        try {
            return await this.app.vault.read(file);
        } catch (error) {
            throw new Error(`Failed to load file: ${file.path}`);
        }
    }

    /**
     * Parse markdown content to mind map nodes
     */
    parseMarkdownToNodes(content: string): MindMapNode[] {
        const { allNodes } = parseMarkdownContent(content, 'unknown.md');
        return allNodes;
    }

    /**
     * Parse markdown content to complete mind map data
     */
    parseMarkdownToData(content: string, filePath: string): MindMapData {
        return parseMarkdownContent(content, filePath);
    }

    /**
     * Save mind map data to markdown file
     */
    async saveToMarkdownFile(filePath: string, rootNode: MindMapNode): Promise<void> {
        try {
            const newContent = generateMarkdownFromNodes(rootNode);
            const file = this.app.vault.getAbstractFileByPath(filePath);

            if (file instanceof TFile) {
                await this.app.vault.modify(file, newContent);
            } else {
                throw new Error(`File not found: ${filePath}`);
            }
        } catch (error) {
            throw new Error(`Failed to save file: ${filePath}`);
        }
    }

    /**
     * Create a new mind map file
     */
    async createMindMapFile(filePath: string, title: string): Promise<TFile> {
        try {
            const content = `#mindmap

* ${title}
`;
            return await this.app.vault.create(filePath, content);
        } catch (error) {
            throw new Error(`Failed to create file: ${filePath}`);
        }
    }

    /**
     * Check if file exists
     */
    fileExists(filePath: string): boolean {
        return this.app.vault.getAbstractFileByPath(filePath) !== null;
    }
}