/**
 * Mobile Tree Renderer
 *
 * Mobile-specific renderer that extends DesktopTreeRenderer
 * Uses RendererCoordinator with mobile-specific features enabled
 */

import { App } from 'obsidian';
import { MindMapConfig } from '../config/types';
import { MindMapData } from '../interfaces/mindmap-interfaces';
import { DesktopTreeRenderer } from './desktop-tree-renderer';
import { MindMapService } from '../services/mindmap-service';
import { MindMapMessages } from '../i18n';

/**
 * Mobile tree renderer class
 *
 * Extends DesktopTreeRenderer to provide mobile-specific rendering
 *
 * Architecture:
 * - MobileTreeRenderer extends DesktopTreeRenderer
 * - DesktopTreeRenderer uses RendererCoordinator
 * - RendererCoordinator detects mobile via config.isMobile
 * - Mobile-specific features enabled in RendererCoordinator:
 *   - MobileToolbar (edit, copy, paste, delete buttons)
 *   - Touch interactions (handled by InteractionManager)
 *   - Mobile layout parameters
 *
 * Mobile-specific behavior:
 * - Uses touch interactions (tap, pinch, drag)
 * - Shows mobile toolbar on node selection
 * - No + buttons (uses toolbar instead)
 * - Optimized for mobile screen sizes
 */
export class MobileTreeRenderer extends DesktopTreeRenderer {
    /**
     * Constructor - initializes mobile renderer
     *
     * @param app - Obsidian app instance
     * @param config - Configuration object with mobile-specific settings (config.isMobile = true)
     * @param mindMapService - MindMap service instance
     * @param messages - i18n messages object
     */
    constructor(app: App, config: MindMapConfig, mindMapService: MindMapService, messages?: MindMapMessages, isActiveView?: () => boolean) {
        // Initialize with parent class (which creates RendererCoordinator)
        // The config.isMobile flag enables mobile-specific features
        super(app, config, mindMapService, messages, isActiveView);
    }

    /**
     * Render mind map data with mobile optimizations
     *
     * @param container - DOM element to render into
     * @param data - Mind map data structure
     */
    render(container: Element, data: MindMapData): void {
        // Add mobile-specific CSS class to container
        // This activates all the mobile styles in styles.css
        container.classList.add('is-mobile');

        // Call parent implementation (uses RendererCoordinator with mobile config)
        super.render(container, data);

        // Note: All mobile-specific behavior is handled by RendererCoordinator:
        // - MobileToolbar is created when config.isMobile = true
        // - Touch interactions are handled by InteractionManager
        // - Layout parameters use mobile config values
    }

    /**
     * Destroy the renderer and clean up resources
     */
    destroy(): void {
        // Remove mobile-specific CSS class
        const container = document.querySelector('.mind-map-container.is-mobile');
        if (container) {
            container.classList.remove('is-mobile');
        }

        // Call parent implementation (destroys RendererCoordinator)
        super.destroy();
    }
}
