/**
 * UndoManager
 *
 * Manages undo/redo functionality using memento pattern (full state snapshots)
 */

import { MindMapData, MindMapNode } from '../interfaces/mindmap-interfaces';

export class UndoManager {
    private undoStack: MindMapData[] = [];
    private redoStack: MindMapData[] = [];
    private readonly MAX_STACK_SIZE = 5;

    /**
     * Save current state as a snapshot before modification
     */
    saveSnapshot(data: MindMapData): void {

        // Deep clone the data to avoid reference issues
        const snapshot: MindMapData = {
            rootNode: data.rootNode ? this.deepCloneNode(data.rootNode) : null,
            allNodes: data.allNodes.map(node => this.deepCloneNode(node)),
            maxLevel: data.maxLevel
        };

        // Rebuild parent references after cloning
        if (snapshot.rootNode) {
            this.rebuildParentReferences(snapshot.rootNode);
        }


        this.undoStack.push(snapshot);

        // Limit stack size to MAX_STACK_SIZE (FIFO)
        if (this.undoStack.length > this.MAX_STACK_SIZE) {
            const removed = this.undoStack.shift();
        }


        // Clear redo stack when new action is performed
        this.redoStack = [];
    }

    /**
     * Undo to previous state
     * @param currentState The current state to save before undoing
     * @returns The previous state, or null if nothing to undo
     */
    undo(currentState: MindMapData): MindMapData | null {
        if (this.undoStack.length === 0) {
            return null;
        }

        // Save current state to redo stack (deep clone)
        const snapshot: MindMapData = {
            rootNode: currentState.rootNode ? this.deepCloneNode(currentState.rootNode) : null,
            allNodes: currentState.allNodes.map(node => this.deepCloneNode(node)),
            maxLevel: currentState.maxLevel
        };
        if (snapshot.rootNode) {
            this.rebuildParentReferences(snapshot.rootNode);
        }
        this.redoStack.push(snapshot);

        // Pop and return previous state from undo stack
        return this.undoStack.pop() || null;
    }

    /**
     * Redo to next state
     * @param currentState The current state to save before redoing
     * @returns The next state, or null if nothing to redo
     */
    redo(currentState: MindMapData): MindMapData | null {
        if (this.redoStack.length === 0) {
            return null;
        }

        // Save current state to undo stack (deep clone)
        const snapshot: MindMapData = {
            rootNode: currentState.rootNode ? this.deepCloneNode(currentState.rootNode) : null,
            allNodes: currentState.allNodes.map(node => this.deepCloneNode(node)),
            maxLevel: currentState.maxLevel
        };
        if (snapshot.rootNode) {
            this.rebuildParentReferences(snapshot.rootNode);
        }
        this.undoStack.push(snapshot);

        // Pop and return next state from redo stack
        return this.redoStack.pop() || null;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Get undo stack size (for debugging/UI display)
     */
    getUndoCount(): number {
        return this.undoStack.length;
    }

    /**
     * Get redo stack size (for debugging/UI display)
     */
    getRedoCount(): number {
        return this.redoStack.length;
    }

    /**
     * Clear all history (called when loading new file)
     */
    clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Deep clone a MindMapNode recursively
     */
    private deepCloneNode(node: MindMapNode): MindMapNode {
        const clone = { ...node };

        // Deep clone children recursively
        if (node.children && Array.isArray(node.children)) {
            clone.children = node.children.map((child: MindMapNode) => this.deepCloneNode(child));
        }

        // Remove parent reference (will be reconstructed)
        clone.parent = null;

        return clone;
    }

    /**
     * Rebuild parent references for all nodes in the tree
     * This must be called after deep cloning to restore parent links
     */
    private rebuildParentReferences(node: MindMapNode): void {
        if (!node || !node.children || !Array.isArray(node.children)) {
            return;
        }

        // Set parent for each child and recursively rebuild
        for (const child of node.children) {
            child.parent = node;
            this.rebuildParentReferences(child);
        }
    }
}
