/**
 * 中文语言包
 * Chinese Language Pack for openMindMap plugin
 */

import { MindMapMessages } from './types';

export const zh: MindMapMessages = {
	// ==================== Notices (通知消息) ====================
	notices: {
		// File operations
		fileCreated: '✅ 已创建新的 mindmap 文件：{fileName}',
		fileCreateFailed: '❌ 创建文件失败',
		fileCreateError: '❌ 创建文件失败：{error}',

		// Node operations
		nodeDeleted: '节点已删除',
		cannotDeleteRoot: '⚠️ 中心主题（根节点）不能删除',
		cannotDeleteNoParent: '⚠️ 节点没有父节点，无法删除',
		nodeCreated: '已创建：{nodeText}',
		nodeCreateFailed: '创建节点失败：{error}',

		// Editing operations
		nodeTextCopied: '节点文本已复制到剪贴板',
		copyFailed: '复制失败，请手动复制',
		alreadyAdded: '已添加：{nodeText}',

		// AI operations
		aiAnalyzing: '🤖 AI 正在分析"{nodeText}"...',
		aiNoSuggestions: '未生成建议。尝试重新表述您的提示词。',
		aiFailed: '❌ AI 建议失败：{error}',

		// Settings
		apiConnectionSuccess: '✅ API 连接成功！',
		apiConnectionFailed: '❌ API 连接失败。请检查设置详情。',
		apiTestTimeout: '请求超时（10秒）。API 服务器未响应。请检查网络连接和 API URL。',
		promptsReset: '✅ 提示词模板已重置为默认值',
		deviceTypeChanged: '设备类型已更改。请重新加载 Obsidian 以应用更改。',
		connectionTestFailed: '❌ 连接测试失败',

		// Language
		languageChanged: '语言已更改为 {language}。重新加载 Obsidian 以应用更改。',

		// Editing
		editSuccess: '节点文本已更新',
	},

	// ==================== Errors (错误消息) ====================
	errors: {
		// File errors
		fileNotFound: '错误：未找到文件：{filePath}',
		fileLoadError: '加载文件时出错：{error}',
		noMindmapFile: '未指定或未找到思维导图文件。请确保文件以 #mindmap 开头',

		// API errors
		apiKeyNotConfigured: '❌ 错误：未配置 API 密钥。请在设置中输入您的 API 密钥。',
		apiBaseUrlNotConfigured: '❌ 错误：未配置 API 基础 URL。',
		apiError: '❌ 错误：{error}',
		networkError: '❌ 网络错误：{error}。请检查您的互联网连接和 API URL。',

		// Validation errors
		nodeTextEmpty: '节点文本不能为空',
		nodeTextInvalid: '节点文本不能为空或包含无效字符',
		focusSetFailed: '焦点设置失败，请重试',
		enterEditModeFailed: '进入编辑模式失败，请重试',
		saveFailed: '保存失败，请重试',
		editElementNotFound: '无法找到编辑元素',
		textElementNotFound: '无法找到文本元素',
		enterEditModeError: '进入编辑模式时发生错误',

		// AI errors
		emptyNodeError: '节点文本为空。请先为节点添加文本。',

		// General errors
		serviceNotAvailable: '思维导图服务不可用',
		error: '错误：{message}',
	},

	// ==================== Validation (验证消息) ====================
	validation: {
		cannotEditRoot: '中心主题（文件名）不允许修改',
		cannotPasteRoot: '无法粘贴到根节点',
		cannotCreateSiblingRoot: '无法为根节点创建兄弟节点',
	},

	// ==================== Settings (设置界面) ====================
	settings: {
		title: 'openMindMap 插件设置',

		// Device settings
		deviceSection: '设备设置',
		deviceType: '设备类型',
		deviceTypeDesc: '选择思维导图的渲染方式。将根据您的设备自动检测。',
		deviceAuto: '自动检测',
		deviceDesktop: '桌面模式',
		deviceMobile: '移动模式',

		// Language settings
		languageSection: '语言设置',
		language: '语言',
		languageDesc: '选择插件界面的首选语言。',
		languageEnglish: 'English',
		languageChinese: '中文',

		// AI configuration
		aiSection: 'AI 配置（OpenAI 兼容 API）',
		aiSectionDesc: '配置您的 AI API 以启用智能功能，如自动节点建议。',
		aiSecurity: '🔒 安全性：您的 API 密钥在存储前使用 AES-GCM（256 位）加密。加密后的密钥存储在 data.json 中，只能在此设备上解密。',

		aiBaseUrl: 'OpenAI API 基础 URL',
		aiBaseUrlDesc: '您的 OpenAI 兼容 API 的基础 URL（例如：https://api.openai.com/v1）',
		aiBaseUrlPlaceholder: 'https://api.openai.com/v1',

		aiApiKey: 'OpenAI API 密钥',
		aiApiKeyDesc: '您的 OpenAI API 密钥（以 sk- 开头）',
		aiApiKeyPlaceholder: 'sk-...',

		aiModel: '模型名称',
		aiModelDesc: '要使用的模型名称（例如：gpt-3.5-turbo、gpt-4、llama2、mistral 等）',
		aiModelPlaceholder: 'gpt-3.5-turbo',

		aiTestConnection: '测试连接',
		aiTestConnectionDesc: '测试您的 API 配置以确保其正常工作',
		aiTestButton: '测试连接',
		aiTesting: '测试中...',

		// AI prompt configuration
		aiPromptSection: 'AI 提示词配置',
		aiPromptSectionDesc: '通过编辑系统消息和提示词模板来自定义 AI 生成建议的方式。',

		aiSystemMessage: 'AI 系统消息',
		aiSystemMessageDesc: '定义 AI 助手的角色和行为。这为所有 AI 交互设置上下文。',
		aiSystemMessagePlaceholder: '你是一个有用的思维导图助手...',

		aiPromptTemplate: 'AI 提示词模板',
		aiPromptTemplateDesc: '自定义节点建议的提示词模板。可用变量：{nodeText}、{level}、{parentContext}、{siblingsContext}、{existingChildren}、{centralTopic}',
		aiPromptTemplatePlaceholder: '请建议 3-5 个子节点...',

		aiPromptVariables: '可用变量：',
		aiPromptVariableNodeText: '{nodeText}：当前节点的文本内容',
		aiPromptVariableLevel: '{level}：当前节点的层级（0=根节点，1=第一层，等）',
		aiPromptVariableParent: '{parentContext}：来自父节点的上下文',
		aiPromptVariableSiblings: '{siblingsContext}：来自兄弟节点的上下文',
		aiPromptVariableChildren: '{existingChildren}：当前节点的现有子节点',
		aiPromptVariableCentral: '{centralTopic}：思维导图的根/中心主题',

		aiResetPrompts: '重置提示词',
		aiResetPromptsDesc: '将提示词模板重置为默认值',
		aiResetButton: '重置为默认值',
	},

	// ==================== UI Elements (界面元素) ====================
	ui: {
		// Commands
		commandOpenView: '打开思维导图视图',
		commandOpenAsMindmap: '将当前文件作为思维导图打开',

		// Loading
		loading: '正在加载 openMindMap...',
		initializing: '正在初始化...',
		loadingFile: '正在加载文件...',

		// Headers
		appHeader: '🧠 openMindMap',
		debugInfo: '调试信息：',
		instanceFilePath: '实例文件路径：',
		stateLoaded: '状态已加载：',
		activeFile: '当前文件：',

		// Context menu
		createNewFile: '新建 openMindMap 文件',
		contextEdit: '编辑',
		contextCopy: '复制',
		contextPaste: '粘贴',
		contextDelete: '删除',

		// AI panel
		aiSuggestionsTitle: '✨ AI 建议',
		aiAddAll: '全部添加',
		aiAddAllTooltip: '创建所有建议',
		aiClose: '✕',

		// Edit hints (device-specific)
		editHintDesktop: '双击编辑 | Enter：保存 | Alt+Enter：换行 | Escape：取消',
		editHintMobile: '点击编辑 | Enter：换行 | 点击外部保存',
	},

	// ==================== Helper Methods ====================
	format(message: string, params: Record<string, string | number>): string {
		return message.replace(/\{(\w+)\}/g, (match, key) => {
			const value = params[key as keyof typeof params];
			return value !== undefined ? String(value) : match;
		});
	},
};
