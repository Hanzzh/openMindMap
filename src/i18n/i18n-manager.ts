/**
 * I18n Manager - Handles language switching and message retrieval
 */

import { SupportedLanguage, MindMapMessages } from './types';
import { en } from './en';
import { zh } from './zh';

/**
 * I18n Manager class
 * Manages language state and provides translated messages
 */
export class I18nManager {
	private currentLanguage: SupportedLanguage;
	private messages: MindMapMessages;

	constructor(language: SupportedLanguage = 'en') {
		this.currentLanguage = language;
		this.messages = this.loadMessages(language);
	}

	/**
	 * Load messages for a specific language
	 */
	private loadMessages(language: SupportedLanguage): MindMapMessages {
		switch (language) {
			case 'zh':
				return zh;
			case 'en':
			default:
				return en;
		}
	}

	/**
	 * Get current language
	 */
	getLanguage(): SupportedLanguage {
		return this.currentLanguage;
	}

	/**
	 * Set current language and reload messages
	 */
	setLanguage(language: SupportedLanguage): void {
		if (language !== this.currentLanguage) {
			this.currentLanguage = language;
			this.messages = this.loadMessages(language);
		}
	}

	/**
	 * Get messages object for current language
	 */
	getMessages(): MindMapMessages {
		return this.messages;
	}

	/**
	 * Format a message with parameters
	 * @param key Message key in dot notation (e.g., 'notices.cannotDeleteRoot')
	 * @param params Optional parameters to replace in message
	 * @returns Formatted message string
	 */
	format(key: string, params?: Record<string, string | number>): string {
		// Access nested property using dot notation
		const message = this.getNestedValue(this.messages as unknown as Record<string, unknown>, key);

		if (!message) {
			return key;
		}

		// Replace parameters if provided
		if (params) {
			return this.replaceParams(message, params);
		}

		return message;
	}

	/**
	 * Get nested value from object using dot notation
	 */
	private getNestedValue(obj: Record<string, unknown>, path: string): string {
		const result = path.split('.').reduce((current: unknown, prop) => {
			if (current && typeof current === 'object' && prop in current) {
				return (current as Record<string, unknown>)[prop];
			}
			return undefined;
		}, obj as unknown);
		return (result as string) || '';
	}

	/**
	 * Replace parameters in message template
	 * Supports {param} syntax
	 */
	private replaceParams(message: string, params: Record<string, string | number>): string {
		return message.replace(/\{(\w+)\}/g, (match, key) => {
			return params[key] !== undefined ? String(params[key]) : match;
		});
	}
}

/**
 * Create i18n manager instance with specified language
 */
export function createI18nManager(language: SupportedLanguage = 'en'): I18nManager {
	return new I18nManager(language);
}
