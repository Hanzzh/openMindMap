/**
 * Accessibility utility for screen reader support
 *
 * Provides functionality to announce dynamic changes to screen readers
 * using ARIA live regions.
 */

export class AccessibilityUtil {
	private static liveRegion: HTMLElement | null = null;

	/**
	 * Initialize the live region for screen reader announcements
	 * Creates a hidden div with aria-live attribute
	 */
	private static ensureLiveRegion(): void {
		if (!this.liveRegion) {
			this.liveRegion = document.createElement('div');
			this.liveRegion.setAttribute('role', 'status');
			this.liveRegion.setAttribute('aria-live', 'polite');
			this.liveRegion.setAttribute('aria-atomic', 'true');
			this.liveRegion.className = 'mindmap-announcer';
			// Hide visually but keep accessible to screen readers
			this.liveRegion.style.cssText = `
				position: absolute;
				left: -10000px;
				width: 1px;
				height: 1px;
				overflow: hidden;
			`;
			document.body.appendChild(this.liveRegion);
		}
	}

	/**
	 * Announce a message to screen readers
	 * @param message The message to announce
	 * @param priority Whether to use 'assertive' (immediate) or 'polite' (next available) announcement
	 */
	static announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
		this.ensureLiveRegion();

		if (this.liveRegion) {
			// Update aria-live if priority changed
			if (priority === 'assertive' && this.liveRegion.getAttribute('aria-live') !== 'assertive') {
				this.liveRegion.setAttribute('aria-live', 'assertive');
			}

			this.liveRegion.textContent = '';

			// Use setTimeout to ensure the DOM update is registered
			setTimeout(() => {
				if (this.liveRegion) {
					this.liveRegion.textContent = message;
				}
			}, 100);
		}
	}

	/**
	 * Announce that nodes were added
	 * @param count Number of nodes added
	 */
	static announceNodesAdded(count: number): void {
		this.announce(`Added ${count} node${count !== 1 ? 's' : ''} to mind map`);
	}

	/**
	 * Announce that a node was deleted
	 * @param nodeText The text of the deleted node
	 */
	static announceNodeDeleted(nodeText: string): void {
		this.announce(`Deleted node: ${nodeText}`);
	}

	/**
	 * Announce that a node was edited
	 * @param oldText Old node text
	 * @param newText New node text
	 */
	static announceNodeEdited(oldText: string, newText: string): void {
		this.announce(`Node "${oldText}" changed to "${newText}"`);
	}

	/**
	 * Announce an error
	 * @param errorMessage The error message
	 */
	static announceError(errorMessage: string): void {
		this.announce(`Error: ${errorMessage}`, 'assertive');
	}

	/**
	 * Announce that a node was expanded or collapsed
	 * @param nodeText The node text
	 * @param expanded Whether the node was expanded (true) or collapsed (false)
	 */
	static announceNodeToggled(nodeText: string, expanded: boolean): void {
		this.announce(`Node "${nodeText}" ${expanded ? 'expanded' : 'collapsed'}`);
	}

	/**
	 * Clean up the live region
	 */
	static destroy(): void {
		if (this.liveRegion && this.liveRegion.parentNode) {
			this.liveRegion.parentNode.removeChild(this.liveRegion);
			this.liveRegion = null;
		}
	}
}
