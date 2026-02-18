/**
 * Desktop Tree Renderer
 *
 * Desktop-specific renderer that uses RendererCoordinator
 * Coordinates all feature modules for desktop rendering
 */

import { App } from 'obsidian';
import { MindMapConfig } from '../config/types';
import { MindMapRenderer, MindMapData, MindMapNode } from '../interfaces/mindmap-interfaces';
import { RendererCoordinator } from './renderer-coordinator';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n';

/**
 * Desktop tree renderer class
 *
 * Uses RendererCoordinator to provide modular desktop rendering
 *
 * Architecture:
 * - DesktopTreeRenderer wraps RendererCoordinator
 * - RendererCoordinator integrates all 6 feature modules:
 *   - InteractionManager (MouseInteraction + KeyboardManager)
 *   - AIAssistant
 *   - NodeEditor
 *   - ClipboardManager
 *   - ButtonRenderer
 *   - MobileToolbar (disabled on desktop)
 * - All rendering calls are delegated to RendererCoordinator
 * - Maintains 100% backward compatibility with old D3TreeRenderer
 *
 * Desktop-specific behavior:
 * - Uses mouse interactions (click, drag, zoom)
 * - Uses keyboard shortcuts
 * - Shows + buttons on node selection
 * - No mobile toolbar (config.isMobile = false)
 */
export class DesktopTreeRenderer implements MindMapRenderer {
    private rendererCoordinator: RendererCoordinator;

    /**
     * Constructor - creates the renderer coordinator
     *
     * @param app - Obsidian app instance (not used directly, available for future extensions)
     * @param config - Configuration object with desktop-specific settings
     * @param mindMapService - MindMap service instance
     * @param messages - i18n messages object
     */
	constructor(app: App, config: MindMapConfig, mindMapService: MindMapService, messages?: MindMapMessages, isActiveView?: () => boolean) {
		// Create RendererCoordinator with desktop config
		this.rendererCoordinator = new RendererCoordinator(
			mindMapService,
			config,
			messages,
			isActiveView
		);

		// Note: onTextChanged and onDataUpdated callbacks are set externally by MindMapView
		// Use the getter/setter properties to configure these callbacks
	}

    /**
     * Render mind map data
     * Delegates to RendererCoordinator
     *
     * @param container - DOM element to render into
     * @param data - Mind map data structure
     */
    render(container: Element, data: MindMapData): void {
        this.rendererCoordinator.render(container, data);
    }

	/**
	 * Destroy the renderer and clean up resources
	 * Delegates to RendererCoordinator
	 */
	destroy(): void {
		this.rendererCoordinator.destroy();
	}

	/**
	 * Get the underlying renderer coordinator
	 * Useful for accessing coordinator methods during transition period
	 */
	getRendererCoordinator(): RendererCoordinator {
		return this.rendererCoordinator;
	}

	/**
	 * onTextChanged callback getter/setter
	 * Exposes RendererCoordinator's callback property for external use
	 */
	get onTextChanged() {
		return this.rendererCoordinator.onTextChanged;
	}

	set onTextChanged(callback: ((node: d3.HierarchyNode<MindMapNode>, newText: string) => void) | undefined) {
		this.rendererCoordinator.onTextChanged = callback;
	}

	/**
	 * onDataUpdated callback getter/setter
	 * Exposes RendererCoordinator's callback property for external use
	 */
	get onDataUpdated() {
		return this.rendererCoordinator.onDataUpdated;
	}

	set onDataUpdated(callback: (() => void) | undefined) {
		this.rendererCoordinator.onDataUpdated = callback;
	}
}
