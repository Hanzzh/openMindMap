/**
 * AI Client for OpenAI-compatible API
 * Handles communication with OpenAI or compatible services
 */

import { AIPrompts, NodeContext } from './ai-prompts';

// Re-export NodeContext for external use
export type { NodeContext };

export interface AIConfiguration {
	apiBaseUrl: string;
	apiKey: string;
	model: string;
}

export interface TestConnectionResult {
	success: boolean;
	message: string;
}

export class AIClient {
	private config: AIConfiguration;

	constructor(config: AIConfiguration) {
		this.config = config;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: AIConfiguration): void {
		this.config = config;
	}

	/**
	 * Test API connection by sending a simple request
	 */
	async testConnection(): Promise<TestConnectionResult> {
		// Check if API key is configured
		if (!this.config.apiKey || this.config.apiKey.trim() === '') {
			return {
				success: false,
				message: '❌ Error: API key is not configured. Please enter your API key in settings.'
			};
		}

		// Check if API base URL is configured
		if (!this.config.apiBaseUrl || this.config.apiBaseUrl.trim() === '') {
			return {
				success: false,
				message: '❌ Error: API base URL is not configured.'
			};
		}

		try {
			const apiUrl = `${this.config.apiBaseUrl}/chat/completions`;


			const response = await fetch(apiUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.config.apiKey}`
				},
				body: JSON.stringify({
					model: this.config.model,
					messages: [
						{ role: 'user', content: 'Hi' }
					],
					max_tokens: 10,
					temperature: 0.7
				})
			});


			if (response.ok) {
				const data = await response.json();

				// Validate response structure
				try {
					const content = this.validateAPIResponseStructure(data, 'testConnection');

					return {
						success: true,
						message: '✅ Connection successful! API is working correctly.'
					};
				} catch (validationError) {
					const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);

					return {
						success: false,
						message: `❌ API returned invalid response: ${errorMessage}`
					};
				}
			} else {
				// Handle error response
				let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

				try {
					const errorData = await response.json();
					if (errorData.error?.message) {
						errorMessage = errorData.error.message;
					}
				} catch (e) {
					// Ignore JSON parse errors when extracting error details
				}


				return {
					success: false,
					message: `❌ Error: ${errorMessage}`
				};
			}
		} catch (error) {
			// Network error or other exception
			const errorMessage = error instanceof Error ? error.message : String(error);

			return {
				success: false,
				message: `❌ Network error: ${errorMessage}. Please check your internet connection and API URL.`
			};
		}
	}

	/**
	 * Send a chat completion request
	 * This will be used in future features for node suggestions
	 */
	async chat(userMessage: string, systemMessage?: string): Promise<string> {
		if (!this.config.apiKey || this.config.apiKey.trim() === '') {
			throw new Error('API key is not configured');
		}

		const apiUrl = `${this.config.apiBaseUrl}/chat/completions`;

		const messages: Array<{role: string; content: string}> = [];

		if (systemMessage) {
			messages.push({ role: 'system', content: systemMessage });
		}

		messages.push({ role: 'user', content: userMessage });

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.config.apiKey}`
			},
			body: JSON.stringify({
				model: this.config.model,
				messages: messages,
				max_tokens: 3000,
				temperature: 0.7
			})
		});

		// Log HTTP status and headers

		if (!response.ok) {
			let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
			try {
				const errorData = await response.json();
				if (errorData.error?.message) {
					errorMessage = errorData.error.message;
				}
			} catch (e) {
				// Ignore JSON parse errors when extracting error details
			}
			throw new Error(errorMessage);
		}

		const data = await response.json();

		// Validate response structure
		const content = this.validateAPIResponseStructure(data, 'chat');

		return content;
	}

	/**
	 * Suggest child nodes for a given node
	 * @param context Node context information
	 * @param promptTemplate User-configured prompt template
	 * @param systemMessage System message for AI
	 * @returns Array of node suggestions
	 */
	async suggestChildNodes(
		context: NodeContext,
		promptTemplate: string,
		systemMessage: string
	): Promise<string[]> {
		try {
			// Validate node text
			if (!context.nodeText || context.nodeText.trim() === '') {
				throw new Error('Node text is empty. Please add text to the node first.');
			}

			// Validate API configuration before making request
			this.validateConfiguration();

			// Validate prompt template length
			if (promptTemplate && promptTemplate.length > 10000) {
				throw new Error('Prompt template is too long (max 10000 characters).');
			}

			// Validate system message length
			if (systemMessage && systemMessage.length > 5000) {
				throw new Error('System message is too long (max 5000 characters).');
			}

			// 1. Build user prompt by replacing variables

			const userPrompt = AIPrompts.buildUserPrompt(promptTemplate, context);


			// 2. Call AI API
			const response = await this.chat(userPrompt, systemMessage);


			// 3. Parse JSON response
			const suggestions = this.parseJSONResponse(response);


			// 4. Deduplicate and filter
			const filtered = this.deduplicateSuggestions(suggestions, context.existingChildren);


			return filtered;
		} catch (error) {
			// Enhance error with context
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Re-throw with additional context
			if (error instanceof Error) {
				throw new Error(`AI suggestion failed for node "${context.nodeText}": ${errorMessage}`);
			} else {
				throw error;
			}
		}
	}

	/**
	 * Parse JSON response from AI
	 * @param response AI response text
	 * @returns Parsed array of suggestions
	 */
	private parseJSONResponse(response: string): string[] {
		try {
			// Try to extract JSON array from response
			const jsonMatch = response.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				if (Array.isArray(parsed)) {
					return parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
				}
			}

			// If no JSON found, split by lines
			return response
				.split('\n')
				.map(line => line.trim())
				.filter(line =>
					line.length > 0 &&
					!line.startsWith('```') &&
					!line.startsWith('#') &&
					!line.match(/^[0-9]+\./) // Remove numbered list items
				)
				.map(line => line.replace(/^[-*•]\s*/, '')); // Remove bullet points
		} catch (error) {
			return [];
		}
	}

	/**
	 * Deduplicate suggestions against existing children
	 * @param suggestions AI-generated suggestions
	 * @param existingChildren Existing child nodes
	 * @returns Filtered suggestions
	 */
	private deduplicateSuggestions(suggestions: string[], existingChildren: string[] = []): string[] {
		const existing = new Set(
			existingChildren.map(c => c.toLowerCase().trim())
		);

		return suggestions
			.map(s => s.trim())
			.filter(s => !existing.has(s.toLowerCase()))
			.slice(0, 5); // Maximum 5 suggestions
	}

	/**
	 * Check if the client is properly configured
	 */
	isConfigured(): boolean {
		return !!(this.config.apiBaseUrl && this.config.apiBaseUrl.trim() !== '' &&
		         this.config.apiKey && this.config.apiKey.trim() !== '');
	}

	/**
	 * Validate API configuration
	 * @throws Error if configuration is invalid
	 */
	private validateConfiguration(): void {
		// Check API key
		if (!this.config.apiKey || this.config.apiKey.trim() === '') {
			throw new Error('API key is not configured. Please enter your API key in settings.');
		}

		// Check API base URL
		if (!this.config.apiBaseUrl || this.config.apiBaseUrl.trim() === '') {
			throw new Error('API base URL is not configured.');
		}

		// Validate URL format
		try {
			const url = new URL(this.config.apiBaseUrl);
			// Ensure it's using HTTPS (or localhost for development)
			if (url.protocol !== 'https:' && url.protocol !== 'http:') {
				throw new Error('Invalid URL protocol.');
			}
			// Warn about HTTP (only allow for localhost)
			if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
				throw new Error('HTTP is not secure. Please use HTTPS.');
			}
		} catch (urlError) {
			throw new Error(`Invalid API base URL format: ${this.config.apiBaseUrl}`);
		}

		// Check model name
		if (!this.config.model || this.config.model.trim() === '') {
			throw new Error('Model name is not configured.');
		}

		// Validate model name length and characters
		if (this.config.model.length > 100) {
			throw new Error('Model name is too long (max 100 characters).');
		}
	}

	/**
	 * Validate API response structure and extract content
	 * @param data API response data
	 * @param context Context for error messages (e.g., 'chat', 'suggestions')
	 * @returns Validated content string
	 * @throws Error if response structure is invalid or content is empty
	 */
	private validateAPIResponseStructure(data: {
		choices?: Array<{
			message?: { content?: string; reasoning_content?: string };
			finish_reason?: string;
		}>;
		usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	}, context: string): string {

		// Check if data exists
		if (!data) {
			throw new Error('API returned empty response (no data)');
		}

		// Check if choices array exists
		if (!data.choices || !Array.isArray(data.choices)) {
			throw new Error('API response missing "choices" array. Please check your API configuration.');
		}

		// Check if choices array is not empty
		if (data.choices.length === 0) {
			throw new Error('API returned empty choices array. The model may not be compatible or may have been rate-limited.');
		}

		// Log finish_reason for debugging truncation issues
		const finishReason = data.choices[0].finish_reason;
		if (finishReason) {
			// Can be logged for debugging: 'length', 'stop', 'content_filter', etc.
			if (finishReason === 'length') {
				// Response was truncated due to token limit
			}
		}

		// Log token usage if available
		if (data.usage) {
			// Token usage data available: data.usage.prompt_tokens, completion_tokens, total_tokens
		}

		// Check if first choice has message
		if (!data.choices[0].message) {
			throw new Error('API response missing "message" object in first choice.');
		}

		// Extract content from message (support both standard OpenAI and Zhipu AI formats)
		const message = data.choices[0].message;
		let content = message.content;

		// Fallback to reasoning_content for Zhipu AI compatibility
		// Zhipu AI (glm-4) uses reasoning_content when response is truncated
		if (!content || content.trim() === '') {
			if (message.reasoning_content && message.reasoning_content.trim() !== '') {
				content = message.reasoning_content;
			}
		}

		// Check if content exists after fallback
		if (content === null || content === undefined) {
			throw new Error('API returned null or undefined content. This may indicate content filtering or API limitations.');
		}

		if (typeof content !== 'string') {
			throw new Error(`API returned content with invalid type: ${typeof content}. Expected string.`);
		}

		if (content.trim() === '') {
			throw new Error('API returned empty content. This may indicate:\n' +
				'- Content was filtered by safety systems\n' +
				'- The model name is incorrect\n' +
				'- Token limit was reached (max_tokens too low)\n' +
				'- API provider issues\n\n' +
				'Please check your API configuration and try again.');
		}

		return content;
	}
}
