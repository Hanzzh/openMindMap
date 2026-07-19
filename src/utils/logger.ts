/**
 * Logger utility for debug mode
 *
 * Provides leveled logging with an in-memory buffer. When debug mode is enabled,
 * debug/info entries are recorded into a buffer and mirrored to the console.
 * The buffered entries can be exported to the clipboard via `dumpToClipboard()`.
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
			? '[Logger] Debug mode enabled — logs will be buffered and copied to clipboard on node creation.'
			: '[Logger] Debug mode disabled.';
		// Always log the toggle so the state change is visible even outside debug mode.
		console.info(msg);
		if (enabled) {
			this.info('Logger', 'Debug mode enabled.');
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
			this.buffer = [];
			return true;
		} catch (error) {
			console.error('[Logger] Failed to copy logs to clipboard:', error);
			new Notice('Failed to copy debug logs to clipboard.');
			return false;
		}
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
