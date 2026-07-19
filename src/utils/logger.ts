/**
 * Logger utility for debug mode
 *
 * Provides leveled logging with an in-memory buffer. When debug mode is enabled,
 * debug/info entries are recorded into a buffer and mirrored to the console.
 * The buffered entries can be exported to the clipboard via `flushToClipboard()`
 * (manual trigger by attempting to edit the root node) or `dumpToClipboard()`
 * (auto-trigger, currently unused).
 *
 * warn/error are always forwarded to the console regardless of debug mode so
 * that production behavior stays consistent with the previous console-only usage.
 */

import { Notice } from 'obsidian';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	tag: string;
	message: string;
	data?: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40
};

const MAX_BUFFER_SIZE = 1000;

/**
 * Logger singleton.
 *
 * Usage:
 *   const logger = Logger.getInstance();
 *   logger.setDebugEnabled(true);
 *   logger.debug('RendererCoordinator', 'add child node', { parent, text });
 *   await logger.dumpToClipboard();
 */
export class Logger {
	private static instance: Logger;

	private debugEnabled: boolean = false;
	private buffer: LogEntry[] = [];

	private constructor() {}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/** Enable or disable debug mode. When disabled, debug/info entries are skipped. */
	setDebugEnabled(enabled: boolean): void {
		this.debugEnabled = enabled;
		// Announce the state change so users see confirmation in the console.
		const msg = enabled
			? '[Logger] Debug mode enabled - logs will be buffered. Tap the root node to export.'
			: '[Logger] Debug mode disabled.';
		// Always log the toggle so the state change is visible even outside debug mode.
		console.info(msg);
		if (enabled) {
			this.info('Logger', 'Debug mode enabled. Tap the root node to export logs to clipboard.');
		}
	}

	isDebugEnabled(): boolean {
		return this.debugEnabled;
	}

	/** Debug-level log. Only buffered when debug mode is on. */
	debug(tag: string, message: string, data?: unknown): void {
		if (!this.debugEnabled) return;
		this.pushEntry('debug', tag, message, data);
		console.debug(`[${tag}] ${message}`, data !== undefined ? data : '');
	}

	/**
	 * Lazy-evaluated debug log. The `dataFn` is only invoked when debug mode is on,
	 * so callers can safely pass expensive computations (getBoundingClientRect,
	 * stack traces, JSON serialization) without affecting production performance.
	 *
	 * Example:
	 *   logger.debugLazy('NodeEditor', 'exitEditMode called', () => ({
	 *     stack: new Error().stack?.split('\n').slice(0, 6)
	 *   }));
	 */
	debugLazy(tag: string, message: string, dataFn: () => unknown): void {
		if (!this.debugEnabled) return;
		let data: unknown;
		try {
			data = dataFn();
		} catch (err) {
			data = { __lazyError: err instanceof Error ? err.message : String(err) };
		}
		this.pushEntry('debug', tag, message, data);
		console.debug(`[${tag}] ${message}`, data);
	}

	/** Info-level log. Only buffered when debug mode is on. */
	info(tag: string, message: string, data?: unknown): void {
		if (!this.debugEnabled) return;
		this.pushEntry('info', tag, message, data);
		console.info(`[${tag}] ${message}`, data !== undefined ? data : '');
	}

	/** Warning. Always printed to console; buffered only when debug mode is on. */
	warn(tag: string, message: string, data?: unknown): void {
		if (this.debugEnabled) {
			this.pushEntry('warn', tag, message, data);
		}
		console.warn(`[${tag}] ${message}`, data !== undefined ? data : '');
	}

	/** Error. Always printed to console; buffered only when debug mode is on. */
	error(tag: string, message: string, data?: unknown): void {
		if (this.debugEnabled) {
			this.pushEntry('error', tag, message, data);
		}
		console.error(`[${tag}] ${message}`, data !== undefined ? data : '');
	}

	/** Clear the in-memory log buffer without exporting. */
	clear(): void {
		this.buffer = [];
	}

	/** Returns the current buffered entries (copy). */
	getEntries(): LogEntry[] {
		return this.buffer.slice();
	}

	/**
	 * Dump the accumulated log buffer to the system clipboard.
	 * Shows a Notice on success or failure. Clears the buffer after a successful copy.
	 *
	 * @returns true if the clipboard write succeeded.
	 */
	async dumpToClipboard(): Promise<boolean> {
		return this.writeBufferToClipboard(true);
	}

	/**
	 * Flush the accumulated log buffer to the system clipboard WITHOUT clearing it.
	 * Allows multiple dumps to accumulate history across reproductions.
	 *
	 * Behavioral contract:
	 * - When debug mode is OFF: silent no-op (returns false), no Notice shown.
	 * - When debug mode is ON and buffer is empty: shows "Debug log is empty." Notice.
	 * - When debug mode is ON and buffer has entries: copies to clipboard, shows
	 *   "Debug logs copied to clipboard (N entries)." Notice, KEEPS the buffer.
	 *
	 * @returns true if the clipboard write succeeded (or buffer was empty).
	 */
	async flushToClipboard(): Promise<boolean> {
		return this.writeBufferToClipboard(false);
	}

	/**
	 * Internal helper: format buffer and write to clipboard.
	 *
	 * @param clearAfter If true, buffer is cleared after a successful copy
	 *                   (used by `dumpToClipboard`). If false, buffer is
	 *                   preserved (used by `flushToClipboard`).
	 */
	private async writeBufferToClipboard(clearAfter: boolean): Promise<boolean> {
		if (!this.debugEnabled) {
			return false;
		}

		if (this.buffer.length === 0) {
			new Notice('Debug log is empty.');
			return true;
		}

		const text = this.formatEntries(this.buffer);

		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(text);
			} else {
				// Fallback: temporary textarea + execCommand for non-secure contexts
				this.writeViaTextarea(text);
			}
			new Notice(`Debug logs copied to clipboard (${this.buffer.length} entries).`);
			if (clearAfter) {
				this.buffer = [];
			}
			return true;
		} catch (error) {
			console.error('[Logger] Failed to copy logs to clipboard:', error);
			new Notice('Failed to copy debug logs to clipboard.');
			return false;
		}
	}

	/**
	 * Capture a viewport+container sizing snapshot as a debug log entry.
	 * Zero-op when debug mode is off (no DOM queries, no allocations).
	 *
	 * Collected metrics:
	 * - window.innerWidth / innerHeight
	 * - window.visualViewport (width, height, offsetTop, offsetLeft, scale)
	 * - document.activeElement (tagName + className)
	 * - `.mind-map-container` getBoundingClientRect
	 * - closest SVG ancestor (`.mindmap-content` parent) getBoundingClientRect
	 * - `.node-unified-text.editing` getBoundingClientRect (if present)
	 *
	 * @param tag Logger tag
	 * @param message Logger message
	 * @param extra Optional extra fields merged into the snapshot
	 */
	snapshotViewport(
		tag: string,
		message: string,
		extra?: Record<string, unknown>
	): void {
		if (!this.debugEnabled) return;

		const snapshot: Record<string, unknown> = {
			window: {
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight
			},
			visualViewport: this.snapshotVisualViewport(),
			activeElement: this.snapshotActiveElement(),
			container: this.snapshotElement('.mind-map-container'),
			svg: this.snapshotSvg(),
			editingElement: this.snapshotElement('.node-unified-text.editing')
		};

		if (extra) {
			snapshot.extra = extra;
		}

		this.pushEntry('debug', tag, message, snapshot);
		console.debug(`[${tag}] ${message}`, snapshot);
	}

	private snapshotVisualViewport(): Record<string, unknown> | null {
		const vv = window.visualViewport;
		if (!vv) return null;
		return {
			width: vv.width,
			height: vv.height,
			offsetTop: vv.offsetTop,
			offsetLeft: vv.offsetLeft,
			scale: vv.scale
		};
	}

	private snapshotActiveElement(): Record<string, unknown> | null {
		const el = document.activeElement;
		if (!el || el === document.body) {
			return { tagName: 'body', className: '' };
		}
		return {
			tagName: el.tagName,
			className: typeof el.className === 'string' ? el.className : '',
			contentEditable: (el as HTMLElement).isContentEditable
		};
	}

	private snapshotElement(selector: string): Record<string, unknown> | null {
		const el = document.querySelector(selector) as HTMLElement | null;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return {
			width: rect.width,
			height: rect.height,
			top: rect.top,
			left: rect.left,
			childCount: el.childElementCount
		};
	}

	private snapshotSvg(): Record<string, unknown> | null {
		const content = document.querySelector('.mindmap-content') as SVGGElement | null;
		if (!content) return null;
		const svg = content.closest('svg') as SVGSVGElement | null;
		if (!svg) return null;
		const rect = svg.getBoundingClientRect();
		return {
			width: rect.width,
			height: rect.height,
			top: rect.top,
			left: rect.left,
			attrWidth: svg.getAttribute('width'),
			attrHeight: svg.getAttribute('height'),
			childCount: svg.childElementCount
		};
	}

	private pushEntry(level: LogLevel, tag: string, message: string, data?: unknown): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			tag,
			message,
			data
		};
		this.buffer.push(entry);
		// Prevent unbounded growth if user never triggers a clipboard dump.
		if (this.buffer.length > MAX_BUFFER_SIZE) {
			this.buffer.shift();
		}
	}

	private formatEntries(entries: LogEntry[]): string {
		const header = `# openMindMap debug log\n# Exported: ${new Date().toISOString()}\n# Entries: ${entries.length}\n# Debug mode: ${this.debugEnabled ? 'ON' : 'OFF'}\n\n`;
		const lines = entries.map((entry) => {
			const base = `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message}`;
			if (entry.data === undefined) {
				return base;
			}
			let dataStr: string;
			try {
				dataStr = typeof entry.data === 'string'
					? entry.data
					: JSON.stringify(entry.data, this.jsonReplacer, 2);
			} catch {
				dataStr = String(entry.data);
			}
			return `${base}\n  data: ${dataStr}`;
		});
		return header + lines.join('\n') + '\n';
	}

	/**
	 * JSON.stringify replacer that handles circular references and Error objects.
	 */
	private jsonReplacer(_key: string, value: unknown): unknown {
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				stack: value.stack
			};
		}
		if (typeof value === 'object' && value !== null) {
			// MindMapNode has circular parent references — strip them to keep logs readable.
			const node = value as { parent?: unknown; children?: unknown[] };
			if ('parent' in node && 'children' in node && typeof node.children === 'object') {
				const stripped: Record<string, unknown> = {};
				for (const k of Object.keys(value as object)) {
					if (k === 'parent') {
						stripped.parent = '[MindMapNode]';
					} else {
						stripped[k] = (value as Record<string, unknown>)[k];
					}
				}
				return stripped;
			}
		}
		return value;
	}

	private writeViaTextarea(text: string): void {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		try {
			document.execCommand('copy');
		} finally {
			document.body.removeChild(textarea);
		}
	}
}

/** Convenience module-level accessor. */
export function getLogger(): Logger {
	return Logger.getInstance();
}
