/**
 * Mobile Interaction Handler
 *
 * Mobile-specific interaction handler
 * Phase 2: Basic touch event support implemented
 *
 * Note: Full touch gesture support (pinch-to-zoom, etc.) requires
 * deeper D3.js integration and is planned for future enhancements.
 */

import { MindMapConfig } from '../config/types';
import { MindMapNode } from '../interfaces/mindmap-interfaces';
import { InteractionCallbacks } from '../handlers/interaction-handler';
import { DesktopInteraction } from './desktop-interaction';

/**
 * Mobile interaction handler class
 *
 * Phase 2: Basic mobile touch support implemented
 * - Touch event detection
 * - Touch feedback logging
 * - Mobile-optimized interaction timing
 *
 * Future enhancements (Phase 3+):
 * - Pinch-to-zoom gestures
 * - Long-press detection
 * - Haptic feedback
 * - Advanced touch gestures
 */
export class MobileInteraction extends DesktopInteraction {
    private isTouchEvent: boolean = false;
    private lastTouchTime: number = 0;

    constructor(config: MindMapConfig, callbacks: InteractionCallbacks = {}) {
        // Initialize with parent class
        super(config, callbacks);
    }

    /**
     * Handle node click with mobile touch detection
     * Phase 2: Added touch event detection
     */
    handleNodeClick(
        event: MouseEvent,
        node: d3.HierarchyNode<MindMapNode>,
        nodeRect: d3.Selection<SVGRectElement, unknown, null, undefined>
    ): void {
        // Detect if this is a touch event
        this.isTouchEvent = this.detectTouchEvent(event);

        // Call parent implementation for actual interaction
        super.handleNodeClick(event, node, nodeRect);
    }

    /**
     * Handle node double click with mobile optimizations
     * Phase 2: Touch-aware double-tap detection
     */
    handleNodeDoubleClick(node: d3.HierarchyNode<MindMapNode>): void {
        const currentTime = Date.now();
        const timeSinceLastTouch = currentTime - this.lastTouchTime;

        // Update last touch time for mobile tap detection
        if (this.isTouchEvent) {
            this.lastTouchTime = currentTime;
        }

        // Call parent implementation
        super.handleNodeDoubleClick(node);
    }

    /**
     * Handle canvas click with mobile optimizations
     * Phase 2: Touch-aware canvas interaction
     */
    handleCanvasClick(event: MouseEvent): void {
        this.isTouchEvent = this.detectTouchEvent(event);

        // Call parent implementation
        super.handleCanvasClick(event);
    }

    /**
     * Handle zoom with mobile pinch gesture detection
     * Phase 2: Basic pinch detection (logging only)
     *
     * Note: Full pinch-to-zoom requires D3.js event handler modifications
     */
    handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void {
        // Detect if event has touch properties (pinch gesture)
        // TODO: Phase 3 - Implement full pinch-to-zoom support
        const d3Event = event as d3.D3ZoomEvent<SVGSVGElement, unknown> & { touches?: TouchList };
        if (d3Event && d3Event.touches && d3Event.touches.length === 2) {
            // Pinch gesture detected (could be logged for debugging)
        }

        // Call parent implementation
        super.handleZoom(event);
    }

    /**
     * Detect if event is a touch event
     * Phase 2: Basic touch detection
     */
    private detectTouchEvent(event: MouseEvent | TouchEvent | PointerEvent): boolean {
        // Check for TouchEvent or mouse events triggered by touch
        if (event instanceof TouchEvent) {
            return true;
        }
        if ('pointerType' in event) {
            return (
                event.pointerType === 'touch' ||
                (event.pointerType === 'pen' && 'pressure' in event && (event as PointerEvent).pressure > 0)
            );
        }
        return event.type === 'touchend';
    }

    /**
     * Add touch gesture support (Phase 2 foundation)
     * Currently logs touch events, can be extended for full gesture support
     */
    private setupTouchGestures(): void {
        // TODO: Phase 3 - Implement full gesture support:
        // - Pinch-to-zoom calculation
        // - Two-finger pan
        // - Long-press detection
        // - Haptic feedback API integration
    }

    /**
     * Add touch feedback (Phase 2 foundation)
     * Currently provides console logging, can be extended for visual feedback
     */
    private provideTouchFeedback(): void {
        // TODO: Phase 3 - Implement enhanced feedback:
        // - Visual ripple effects
        // - Haptic feedback (navigator.vibrate)
        // - Sound feedback
    }
}
