/**
 * Renderer Manager
 *
 * Manages renderer selection based on device type
 * Implements early branching pattern to ensure desktop renderer is not affected
 */

import { App } from 'obsidian';
import { MindMapConfig } from '../config/types';
import { MindMapMessages } from '../i18n';
import { MindMapRenderer, MindMapData, MindMapNode } from '../interfaces/mindmap-interfaces';
import { DesktopTreeRenderer } from './desktop-tree-renderer';
import { MobileTreeRenderer } from './mobile-tree-renderer';
import { MindMapService } from '../services/mindmap-service';

/**
 * Renderer manager class
 *
 * Responsibilities:
 * - Detect device type and select appropriate renderer
 * - Provide unified interface for renderer operations
 * - Ensure device-specific renderers are isolated (early branching pattern)
 *
 * Architecture Note:
 * This class implements the early branching pattern where device detection
 * happens once at initialization time. The manager wraps the existing D3TreeRenderer
 * to avoid code duplication and maintain backward compatibility.
 */
export class RendererManager implements MindMapRenderer {
    private renderer: MindMapRenderer;

    /**
     * Constructor - performs device detection and creates renderer
     *
     * @param app - Obsidian app instance
     * @param config - Configuration object from ConfigManager
     * @param mindMapService - MindMap service instance
     * @param messages - Internationalization messages (optional)
     * @param isActiveView - Callback to check if mindmap view is active (optional)
     *
     * Early Branching Pattern:
     * The device detection happens here at initialization time based on config.isMobile.
     * This guarantees that:
     * - Desktop devices always use DesktopTreeRenderer
     * - Mobile devices always use MobileTreeRenderer
     * - No mixing of code paths during operation
     */
    constructor(app: App, config: MindMapConfig, mindMapService: MindMapService, messages?: MindMapMessages, isActiveView?: () => boolean) {
        // 🔒 EARLY BRANCHING: Device-specific renderer selection
        // This is the only place where we check device type for rendering
        // After this point, the renderer is fixed and never changes

        if (config.isMobile) {
            // Mobile path: Use mobile renderer
            this.renderer = new MobileTreeRenderer(app, config, mindMapService, messages, isActiveView);
        } else {
            // Desktop path: Use desktop renderer (existing behavior)
            this.renderer = new DesktopTreeRenderer(app, config, mindMapService, messages, isActiveView);
        }
    }

    /**
     * Render mind map data
     * Delegates to the device-specific renderer
     *
     * @param container - DOM element to render into
     * @param data - Mind map data structure
     */
    render(container: Element, data: MindMapData): void {
        this.renderer.render(container, data);
    }

    /**
     * Destroy the renderer and clean up resources
     * Delegates to the device-specific renderer
     */
    destroy(): void {
        this.renderer.destroy();
    }

    /**
     * Get the active renderer instance
     * Useful for debugging and testing
     */
    getActiveRenderer(): MindMapRenderer {
        return this.renderer;
    }

	/**
	 * Get device type
	 * @returns true if mobile renderer is active, false if desktop
	 */
	isMobile(): boolean {
		return this.renderer instanceof MobileTreeRenderer;
	}

	/**
	 * onTextChanged callback getter/setter
	 * Delegates to the internal renderer (DesktopTreeRenderer or MobileTreeRenderer)
	 */
	get onTextChanged() {
		return this.renderer.onTextChanged;
	}

	set onTextChanged(callback: ((node: d3.HierarchyNode<MindMapNode>, newText: string) => void) | undefined) {
		this.renderer.onTextChanged = callback;
	}

	/**
	 * onDataUpdated callback getter/setter
	 * Delegates to the internal renderer (DesktopTreeRenderer or MobileTreeRenderer)
	 */
	get onDataUpdated() {
		return this.renderer.onDataUpdated;
	}

	set onDataUpdated(callback: (() => void) | undefined) {
		this.renderer.onDataUpdated = callback;
	}
}
