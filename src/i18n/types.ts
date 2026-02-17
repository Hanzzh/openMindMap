/**
 * Type definitions for i18n system
 */

/**
 * Supported languages
 */
export type SupportedLanguage = 'en' | 'zh';

/**
 * MindMap Messages Interface
 * Contains all user-facing messages with TypeScript type safety
 */
export interface MindMapMessages {
	// ==================== Notices (通知消息) ====================
	notices: {
		// File operations
		fileCreated: string;           // ✅ Created mindmap file: {fileName}
		fileCreateFailed: string;      // ❌ Failed to create file
		fileCreateError: string;       // ❌ Failed to create file: {error}

		// Node operations
		nodeDeleted: string;           // Node deleted successfully
		cannotDeleteRoot: string;      // ⚠️ Cannot delete root node
		cannotDeleteNoParent: string;  // ⚠️ Node has no parent, cannot delete
		nodeCreated: string;           // Created: {nodeText}
		nodeCreateFailed: string;      // Failed to create node: {error}

		// Editing operations
		nodeTextCopied: string;        // Node text copied to clipboard
		copyFailed: string;            // Copy failed, please copy manually
		alreadyAdded: string;          // Already added: {nodeText}

		// AI operations
		aiAnalyzing: string;           // 🤖 AI is analyzing "{nodeText}"...
		aiNoSuggestions: string;       // No suggestions generated. Try rephrasing your prompt.
		aiFailed: string;              // ❌ AI suggestions failed: {error}

		// Settings
		apiConnectionSuccess: string;  // ✅ API connection successful!
		apiConnectionFailed: string;   // ❌ API connection failed. Check settings for details.
		apiTestTimeout: string;        // Request timeout after 10 seconds. The API server is not responding.
		promptsReset: string;          // ✅ Prompt templates reset to default
		deviceTypeChanged: string;     // Device type changed. Reload Obsidian to apply changes.
		connectionTestFailed: string;  // ❌ Connection test failed

		// Language
		languageChanged: string;       // Language changed to {language}. Settings page reloaded.

		// Editing
		editSuccess: string;           // Node text updated successfully
	};

	// ==================== Errors (错误消息) ====================
	errors: {
		// File errors
		fileNotFound: string;          // Error: File not found: {filePath}
		fileLoadError: string;         // Error loading file: {error}
		noMindmapFile: string;         // No mind map file specified or found. Make sure the file starts with #mindmap

		// API errors
		apiKeyNotConfigured: string;   // ❌ Error: API key is not configured. Please enter your API key in settings.
		apiBaseUrlNotConfigured: string; // ❌ Error: API base URL is not configured.
		apiError: string;              // ❌ Error: {error}
		networkError: string;          // ❌ Network error: {error}. Please check your internet connection and API URL.

		// Validation errors
		nodeTextEmpty: string;         // Node text cannot be empty
		nodeTextInvalid: string;       // Node text cannot be empty or contain invalid characters
		focusSetFailed: string;        // Failed to set focus, please try again
		enterEditModeFailed: string;   // Failed to enter edit mode, please try again
		saveFailed: string;            // Save failed, please try again
		editElementNotFound: string;   // Edit element not found
		textElementNotFound: string;   // Text element not found
		enterEditModeError: string;    // Error entering edit mode

		// AI errors
		emptyNodeError: string;        // Node text is empty. Please add text to the node first.

		// General errors
		serviceNotAvailable: string;   // Mind map service not available
		error: string;                 // Error: {message}
	};

	// ==================== Validation (验证消息) ====================
	validation: {
		cannotEditRoot: string;        // Central topic (filename) cannot be modified
		cannotPasteRoot: string;       // Cannot paste to root node
		cannotCreateSiblingRoot: string; // Cannot create sibling for root node
	};

	// ==================== Settings (设置界面) ====================
	settings: {
		title: string;                 // Settings for openMindMap Plugin

		// Device settings
		deviceSection: string;         // Device Settings
		deviceType: string;            // Device type
		deviceTypeDesc: string;        // Choose how mind maps should be rendered. Auto-detects based on your device.
		deviceAuto: string;            // Auto-detect
		deviceDesktop: string;         // Desktop mode
		deviceMobile: string;          // Mobile mode

		// Language settings
		languageSection: string;       // Language Settings
		language: string;              // Language
		languageDesc: string;          // Choose your preferred language for the plugin interface.
		languageEnglish: string;       // English
		languageChinese: string;       // 中文

		// AI configuration
		aiSection: string;             // AI Configuration (OpenAI-compatible API)
		aiSectionDesc: string;         // Configure your AI API to enable intelligent features like automatic node suggestions.
		aiSecurity: string;            // 🔒 Security: Your API key is encrypted using AES-GCM (256-bit) before storage. The encrypted key is stored in data.json and can only be decrypted on this device.

		aiBaseUrl: string;             // OpenAI API Base URL
		aiBaseUrlDesc: string;         // The base URL for your OpenAI-compatible API (e.g., https://api.openai.com/v1)
		aiBaseUrlPlaceholder: string;  // https://api.openai.com/v1

		aiApiKey: string;              // OpenAI API Key
		aiApiKeyDesc: string;          // Your OpenAI API key (starts with sk-...)
		aiApiKeyPlaceholder: string;   // sk-...

		aiModel: string;               // Model Name
		aiModelDesc: string;           // The model name to use (e.g., gpt-3.5-turbo, gpt-4, llama2, mistral, etc.)
		aiModelPlaceholder: string;    // gpt-3.5-turbo

		aiTestConnection: string;      // Test Connection
		aiTestConnectionDesc: string;  // Test your API configuration to ensure it works correctly
		aiTestButton: string;          // Test Connection
		aiTesting: string;             // Testing...

		// AI prompt configuration
		aiPromptSection: string;       // AI Prompt Configuration
		aiPromptSectionDesc: string;   // Customize how the AI generates suggestions by editing the system message and prompt template.

		aiSystemMessage: string;       // AI System Message
		aiSystemMessageDesc: string;   // Define the AI assistant role and behavior. This sets the context for all AI interactions.
		aiSystemMessagePlaceholder: string; // You are a helpful mind map assistant...

		aiPromptTemplate: string;      // AI Prompt Template
		aiPromptTemplateDesc: string;  // Customize the prompt template for node suggestions. Available variables: {nodeText}, {level}, {parentContext}, {siblingsContext}, {existingChildren}, {centralTopic}
		aiPromptTemplatePlaceholder: string; // Please suggest 3-5 child nodes...

		aiPromptVariables: string;     // Available variables:
		aiPromptVariableNodeText: string; // {nodeText}: The text content of the current node
		aiPromptVariableLevel: string;     // {level}: The hierarchy level of the current node (0=root, 1=first level, etc.)
		aiPromptVariableParent: string;    // {parentContext}: Context from the parent node
		aiPromptVariableSiblings: string;  // {siblingsContext}: Context from sibling nodes
		aiPromptVariableChildren: string;  // {existingChildren}: Existing child nodes of the current node
		aiPromptVariableCentral: string;   // {centralTopic}: The root/central topic of the mind map

		aiResetPrompts: string;        // Reset Prompts
		aiResetPromptsDesc: string;    // Reset prompt templates to default values
		aiResetButton: string;         // Reset to Defaults
	};

	// ==================== UI Elements (界面元素) ====================
	ui: {
		// Commands
		commandOpenView: string;       // Open mind map view
		commandOpenAsMindmap: string;  // Open current file as mind map

		// Loading
		loading: string;               // Loading openMindMap...
		initializing: string;          // Initializing...
		loadingFile: string;           // Loading file...

		// Headers
		appHeader: string;             // 🧠 openMindMap
		debugInfo: string;             // Debug Info:
		instanceFilePath: string;      // Instance filePath:
		stateLoaded: string;           // State loaded:
		activeFile: string;            // Active file:

		// Context menu
		createNewFile: string;         // New openMindMap file
		contextEdit: string;           // Edit
		contextCopy: string;           // Copy
		contextPaste: string;          // Paste
		contextDelete: string;         // Delete

		// AI panel
		aiSuggestionsTitle: string;    // ✨ AI Suggestions
		aiAddAll: string;              // Add All
		aiAddAllTooltip: string;       // Create all suggestions
		aiClose: string;               // ✕

		// Edit hints (device-specific)
		editHintDesktop: string;       // Double-click to edit | Enter: Save | Alt+Enter: New line | Escape: Cancel
		editHintMobile: string;        // Tap to edit | Enter: New line | Tap outside to save
	};

	// ==================== Helper Methods ====================
	/**
	 * Format a message with parameters
	 * @param message The message template with placeholders like {fileName}
	 * @param params Object containing parameter values
	 * @returns Formatted message
	 */
	format(message: string, params: Record<string, string | number>): string;
}
