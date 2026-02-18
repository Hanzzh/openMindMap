/**
 * Desktop Interaction Handler
 *
 * Desktop-specific interaction handler that wraps the existing D3InteractionHandler
 * Maintains exact same behavior as before migration
 */

import { MindMapConfig } from '../config/types';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { InteractionCallbacks, D3InteractionHandler } from '../handlers/interaction-handler';

/**
 * Desktop interaction handler class
 *
 * Phase 1: Wraps the existing D3InteractionHandler to maintain exact behavior
 * This approach ensures zero risk to desktop functionality.
 *
 * Architecture:
 * - DesktopInteraction wraps D3InteractionHandler
 * - All interaction calls are delegated to the existing implementation
 * - No logic is modified, ensuring 100% backward compatibility
 *
 * TODO: Phase 2 - Enhance with desktop-specific optimizations:
 * - Integrate configuration for customizable interaction behavior
 * - Add desktop-specific keyboard shortcuts
 * - Implement mouse-specific optimizations (hover states, etc.)
 */
export class DesktopInteraction {
    private d3InteractionHandler: D3InteractionHandler;
    private config: MindMapConfig;

    /**
     * Constructor - creates the underlying D3 interaction handler
     *
     * @param config - Configuration object (not used in Phase 1, prepared for Phase 2)
     * @param callbacks - Interaction callbacks
     *
     * Note: Phase 1 ignores the config parameter and uses existing defaults.
     * Phase 2 will integrate config for desktop-specific optimizations.
     */
    constructor(config: MindMapConfig, callbacks: InteractionCallbacks = {}) {
        // Save config for later use
        this.config = config;
        // Phase 1: Create the existing D3InteractionHandler
        // This maintains exact same behavior as before migration
        this.d3InteractionHandler = new D3InteractionHandler(callbacks, undefined, config);
    }

    /**
     * Get the underlying D3 interaction handler
     * This provides access to all existing interaction methods
     */
    getD3InteractionHandler(): D3InteractionHandler {
        return this.d3InteractionHandler;
    }

    /**
     * Handle node click
     * Delegates to the existing D3InteractionHandler implementation
     */
    handleNodeClick(
        event: MouseEvent,
        node: d3.HierarchyNode<MindMapNode>,
        nodeRect: d3.Selection<SVGRectElement, unknown, null, undefined>
    ): void {
        this.d3InteractionHandler.handleNodeClick(event, node, nodeRect);
    }

    /**
     * Handle node double click
     * Delegates to the existing D3InteractionHandler implementation
     */
    handleNodeDoubleClick(node: d3.HierarchyNode<MindMapNode>): void {
        this.d3InteractionHandler.handleNodeDoubleClick(node);
    }

    /**
     * Handle canvas click
     * Delegates to the existing D3InteractionHandler implementation
     */
    handleCanvasClick(event: MouseEvent): void {
        this.d3InteractionHandler.handleCanvasClick(event);
    }

    /**
     * Handle zoom event
     * Delegates to the existing D3InteractionHandler implementation
     */
    handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void {
        this.d3InteractionHandler.handleZoom(event);
    }

    /**
     * Update interaction callbacks
     * Allows dynamic callback updates
     */
    updateCallbacks(callbacks: InteractionCallbacks): void {
        // Phase 1: Create new instance with updated callbacks
        // (D3InteractionHandler doesn't have updateCallbacks method)
        this.d3InteractionHandler = new D3InteractionHandler(callbacks, undefined, this.config);
    }
}
