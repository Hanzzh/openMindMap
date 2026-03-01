/**
 * English Language Pack
 * Default language for openMindMap plugin
 */

import { MindMapMessages } from './types';

export const en: MindMapMessages = {
	// ==================== Notices (通知消息) ====================
	notices: {
		// File operations
		fileCreated: '✅ Created new mindmap file: {fileName}',
		fileCreateFailed: '❌ Failed to create file',
		fileCreateError: '❌ Failed to create file: {error}',

		// Node operations
		nodeDeleted: 'Node deleted successfully',
		cannotDeleteRoot: '⚠️ Central topic (root node) cannot be deleted',
		cannotDeleteNoParent: '⚠️ Node has no parent, cannot delete',
		nodeCreated: 'Created: {nodeText}',
		nodeCreateFailed: 'Failed to create node: {error}',

		// Editing operations
		nodeTextCopied: 'Node text copied to clipboard',
		copyFailed: 'Copy failed, please copy manually',
		alreadyAdded: 'Already added: {nodeText}',

		// AI operations
		aiAnalyzing: '🤖 AI is analyzing "{nodeText}"...',
		aiNoSuggestions: 'No suggestions generated. Try rephrasing your prompt.',
		aiFailed: '❌ AI suggestions failed: {error}',

		// Settings
		apiConnectionSuccess: '✅ API connection successful!',
		apiConnectionFailed: '❌ API connection failed. Check settings for details.',
		apiTestTimeout: 'Request timeout after 10 seconds. The API server is not responding. Please check your network connection and API URL.',
		promptsReset: '✅ Prompt templates reset to default',
		deviceTypeChanged: 'Device type changed. Reload Obsidian to apply changes.',
		connectionTestFailed: '❌ Connection test failed',

		// Language
		languageChanged: 'Language changed to {language}. Reload Obsidian to apply changes.',

		// Editing
		editSuccess: 'Node text updated successfully',
	},

	// ==================== Errors (错误消息) ====================
	errors: {
		// File errors
		fileNotFound: 'Error: File not found: {filePath}',
		fileLoadError: 'Error loading file: {error}',
		noMindmapFile: 'No mind map file specified or found. Make sure the file starts with #mindmap',

		// API errors
		apiKeyNotConfigured: '❌ Error: API key is not configured. Please enter your API key in settings.',
		apiBaseUrlNotConfigured: '❌ Error: API base URL is not configured.',
		apiError: '❌ Error: {error}',
		networkError: '❌ Network error: {error}. Please check your internet connection and API URL.',

		// Validation errors
		nodeTextEmpty: 'Node text cannot be empty',
		nodeTextInvalid: 'Node text cannot be empty or contain invalid characters',
		focusSetFailed: 'Failed to set focus, please try again',
		enterEditModeFailed: 'Failed to enter edit mode, please try again',
		saveFailed: 'Save failed, please try again',
		editElementNotFound: 'Edit element not found',
		textElementNotFound: 'Text element not found',
		enterEditModeError: 'Error entering edit mode',

		// AI errors
		emptyNodeError: 'Node text is empty. Please add text to the node first.',

		// General errors
		serviceNotAvailable: 'Mind map service not available',
		error: 'Error: {message}',
	},

	// ==================== Validation (验证消息) ====================
	validation: {
		cannotEditRoot: 'Central topic (filename) cannot be modified',
		cannotPasteRoot: 'Cannot paste to root node',
		cannotCreateSiblingRoot: 'Cannot create sibling for root node',
	},

	// ==================== Settings (设置界面) ====================
	settings: {
		title: 'Settings for openMindMap Plugin',

		// Device settings
		deviceSection: 'Device settings',
		deviceType: 'Device type',
		deviceTypeDesc: 'Choose how mind maps should be rendered. Auto-detects based on your device.',
		deviceAuto: 'Auto-detect',
		deviceDesktop: 'Desktop mode',
		deviceMobile: 'Mobile mode',

		// Language settings
		languageSection: 'Language settings',
		language: 'Language',
		languageDesc: 'Choose your preferred language for the plugin interface.',
		languageEnglish: 'English',
		languageChinese: '中文',

		// AI configuration
		aiSection: 'AI configuration (OpenAI-compatible API)',
		aiSectionDesc: 'Configure your AI API to enable intelligent features like automatic node suggestions.',
		aiSecurity: '🔒 Security: your API key is encrypted using AES-GCM (256-bit) before storage. The encrypted key is stored in data.json and can only be decrypted on this device.',

		aiBaseUrl: 'OpenAI API base URL',
		aiBaseUrlDesc: 'The base URL for your OpenAI-compatible API (e.g., https://api.openai.com/v1)',
		aiBaseUrlPlaceholder: 'https://api.openai.com/v1',

		aiApiKey: 'OpenAI API key',
		aiApiKeyDesc: 'Your OpenAI API key (starts with sk-...)',
		aiApiKeyPlaceholder: 'sk-...',

		aiModel: 'Model name',
		aiModelDesc: 'The model name to use (e.g., gpt-3.5-turbo, gpt-4, llama2, mistral, etc.)',
		aiModelPlaceholder: 'gpt-3.5-turbo',

		aiTestConnection: 'Test connection',
		aiTestConnectionDesc: 'Test your API configuration to ensure it works correctly',
		aiTestButton: 'Test connection',
		aiTesting: 'Testing...',

		// AI prompt configuration
		aiPromptSection: 'AI prompt configuration',
		aiPromptSectionDesc: 'Customize how the AI generates suggestions by editing the system message and prompt template.',

		aiSystemMessage: 'AI system message',
		aiSystemMessageDesc: 'Define the AI assistant role and behavior. This sets the context for all AI interactions.',
		aiSystemMessagePlaceholder: 'You are a helpful mind map assistant...',

		aiPromptTemplate: 'AI prompt template',
		aiPromptTemplateDesc: 'Customize the prompt template for node suggestions. Available variables: {nodeText}, {level}, {parentContext}, {siblingsContext}, {existingChildren}, {centralTopic}',
		aiPromptTemplatePlaceholder: 'Please suggest 3-5 child nodes...',

		aiPromptVariables: 'Available variables:',
		aiPromptVariableNodeText: '{nodeText}: the text content of the current node',
		aiPromptVariableLevel: '{level}: the hierarchy level of the current node (0=root, 1=first level, etc.)',
		aiPromptVariableParent: '{parentContext}: context from the parent node',
		aiPromptVariableSiblings: '{siblingsContext}: context from sibling nodes',
		aiPromptVariableChildren: '{existingChildren}: existing child nodes of the current node',
		aiPromptVariableCentral: '{centralTopic}: the root/central topic of the mind map',

		aiResetPrompts: 'Reset prompts',
		aiResetPromptsDesc: 'Reset prompt templates to default values',
		aiResetButton: 'Reset to defaults',
	},

	// ==================== UI Elements (界面元素) ====================
	ui: {
		// Commands
		commandOpenView: 'Open mind map view',
		commandOpenAsMindmap: 'Open current file as mind map',

		// Loading
		loading: 'Loading openMindMap...',
		initializing: 'Initializing...',
		loadingFile: 'Loading file...',

		// Headers
		appHeader: '🧠 openMindMap',
		debugInfo: 'Debug Info:',
		instanceFilePath: 'Instance filePath:',
		stateLoaded: 'State loaded:',
		activeFile: 'Active file:',

		// Context menu
		createNewFile: 'New openMindMap file',
		contextEdit: 'Edit',
		contextCopy: 'Copy',
		contextPaste: 'Paste',
		contextDelete: 'Delete',

		// AI panel
		aiSuggestionsTitle: '✨ AI Suggestions',
		aiAddAll: 'Add All',
		aiAddAllTooltip: 'Create all suggestions',
		aiClose: '✕',

		// Edit hints (device-specific)
		editHintDesktop: 'Double-click to edit | Enter: Save | Alt+Enter: New line | Escape: Cancel',
		editHintMobile: 'Tap to edit | Enter: New line | Tap outside to save',
	},

	// ==================== Helper Methods ====================
	format(message: string, params: Record<string, string | number>): string {
		return message.replace(/\{(\w+)\}/g, (match, key) => {
			const value = params[key as keyof typeof params];
			return value !== undefined ? String(value) : match;
		});
	},
};
