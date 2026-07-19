import { App, MarkdownView, ItemView, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, FileView, Notice, Platform, TFolder, TAbstractFile, normalizePath, ViewStateResult } from 'obsidian';
import { RendererManager } from './renderers/renderer-manager';
import { RendererCoordinator } from './renderers/renderer-coordinator';
import { MindMapService } from './services/mindmap-service';
import { MindMapData, MindMapNode, MindMapRenderer } from './interfaces/mindmap-interfaces';
import { ConfigManager } from './config/config-manager';
import { MindMapConfig } from './config/types';
import { AIClient, AIConfiguration, TestConnectionResult } from './utils/ai-client';
import { EncryptionUtil } from './utils/encryption';
import { createI18nManager, MindMapMessages } from './i18n';

export interface MindMapSettings {
	deviceType: 'auto' | 'desktop' | 'mobile';
	language: 'en' | 'zh';
	openaiApiBaseUrl: string;
	openaiApiKey: string;
	openaiModel: string;
	openaiApiKeyEncrypted: boolean;
	aiSystemMessage: string;
	aiPromptTemplate: string;
}

const DEFAULT_SETTINGS: MindMapSettings = {
	deviceType: 'auto',
	language: 'en',
	openaiApiBaseUrl: 'https://api.openai.com/v1',
	openaiApiKey: '',
	openaiModel: 'gpt-3.5-turbo',
	openaiApiKeyEncrypted: false,
	aiSystemMessage: 'You are a professional mind map assistant, skilled at helping users expand and organize knowledge points. Please provide relevant child node suggestions based on the given node content.',
	aiPromptTemplate: `Please suggest 3-5 child nodes for the following mind map node:

Central topic: {centralTopic}
Node content: {nodeText}
Node level: {level}
{parentContext}{siblingsContext}Current children: {existingChildren}

Requirements:
1. Concise and clear (2-8 words)
2. Highly relevant to the central topic
3. Logically connected to the current node
4. Do not duplicate existing content

Please return directly in JSON array format, for example: ["suggestion1", "suggestion2", "suggestion3"]`
}

const MIND_MAP_VIEW_TYPE = "mind-map-view";


// ============================================================================
// 2. 脑图节点构造模块
// ============================================================================


export default class MindMapPlugin extends Plugin {
	settings: MindMapSettings;
	public mindMapService: MindMapService;
	public configManager: ConfigManager;
	public config: MindMapConfig;
	public aiClient: AIClient;
	public messages: MindMapMessages;

	async onload() {
		await this.loadSettings();

		// Initialize encryption utility with vault identifier
		// Use vault name as device identifier instead of navigator API
		const vaultName = this.app.vault.getName();
		const deviceInfo = `obsidian-mindmap-plugin-${vaultName}`;
		EncryptionUtil.initialize(deviceInfo);

		// 🔒 Phase 1: Device detection and configuration initialization
		// This is the ONLY place where we detect device type in the plugin
		// After this point, config.isMobile determines all device-specific behavior

		// 设备检测：根据用户设置选择移动端或桌面端
		let isMobileDevice: boolean;

		// Check user preference
		if (this.settings.deviceType === 'auto') {
			// Auto-detect using Platform API
			isMobileDevice = Platform.isMobile;
		} else {
			// Use user's explicit choice
			isMobileDevice = this.settings.deviceType === 'mobile';
		}

		// Initialize configuration manager with device type and language
		this.configManager = new ConfigManager(isMobileDevice, this.settings.language);
		this.config = this.configManager.getConfig();

		// Initialize service layer (pass config, settings, and AI client for future use)
		this.mindMapService = new MindMapService(this.app, this.config, this.settings, this.aiClient);

		// Initialize i18n
		const i18nManager = createI18nManager(this.settings.language);
		this.messages = i18nManager.getMessages();

		// Load custom styles
		await this.loadStyles();

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon('brain', 'Open mindmap', (evt: MouseEvent) => {
			void this.activateView();
		});
		ribbonIconEl.addClass('mind-map-ribbon-class');

		// Command: Open mind map view
		this.addCommand({
			id: 'open-view',
			name: 'Open mindmap view',
			callback: () => {
				void this.activateView();
			}
		});

		// Command: Open current file as mind map
		this.addCommand({
			id: 'open-current',
			name: 'Open current file as mind map',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						void this.activateView();
					}
					return true;
				}
				return false;
			}
		});

		// Command: Undo
		this.addCommand({
			id: 'undo',
			name: 'Undo',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MindMapView);
				if (activeView) {
					if (!checking) {
						activeView.undo();
					}
					return true;
				}
				return false;
			}
		});

		// Command: Redo
		this.addCommand({
			id: 'redo',
			name: 'Redo',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MindMapView);
				if (activeView) {
					if (!checking) {
						activeView.redo();
					}
					return true;
				}
				return false;
			}
		});

		// Register settings tab
		this.addSettingTab(new MindMapSettingTab(this.app, this));

		// Register the custom view (pass config to view)
		this.registerView(
			MIND_MAP_VIEW_TYPE,
			(leaf) => new MindMapView(leaf, this.mindMapService, this.config)
		);

		// Listen for file open events to detect mind map files
		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				if (file && await this.mindMapService.isMindMapFile(file)) {
					// Replace the current view with mind map view
					await this.replaceWithMindMapView(file);
				}
			})
		);

		// Register file explorer context menu for creating new mindmap files
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				menu.addItem((item) => {
					item.setTitle(this.messages.ui.createNewFile)
						.setIcon('brain')
						.onClick(async () => {
							await this.createNewMindMapFile(file);
						});
				});
			})
		);

		// If the plugin wraps around, create the view when the plugin loads
		this.app.workspace.onLayoutReady(async () => {
			// Check if current file should be mind map
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && await this.mindMapService.isMindMapFile(activeFile)) {
				void this.replaceWithMindMapView(activeFile);
			}
		});
	}

	onunload() {
		// Clean up service references
		this.mindMapService = null;
		this.aiClient = null;
		this.configManager = null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as MindMapSettings);

		// Decrypt API key if encrypted
		if (this.settings.openaiApiKey) {
			if (this.settings.openaiApiKeyEncrypted) {
				// Decrypt the API key
				try {
					this.settings.openaiApiKey = await EncryptionUtil.decrypt(this.settings.openaiApiKey);
				} catch {
					// If decryption fails, keep as is (might be unencrypted)
					this.settings.openaiApiKeyEncrypted = false;
				}
			} else if (EncryptionUtil.isEncrypted(this.settings.openaiApiKey)) {
				// Auto-migrate: looks encrypted but flag not set
				try {
					this.settings.openaiApiKey = await EncryptionUtil.decrypt(this.settings.openaiApiKey);
					this.settings.openaiApiKeyEncrypted = true;
				} catch {
					// Keep as is if decryption fails
				}
			}
		}

		// Initialize AI client with settings (now with decrypted key)
		const aiConfig: AIConfiguration = {
			apiBaseUrl: this.settings.openaiApiBaseUrl,
			apiKey: this.settings.openaiApiKey,
			model: this.settings.openaiModel
		};
		this.aiClient = new AIClient(aiConfig);
	}

	async saveSettings() {
		// Encrypt API key before saving
		const settingsToSave = { ...this.settings };

		if (settingsToSave.openaiApiKey && !settingsToSave.openaiApiKeyEncrypted) {
			// Encrypt the API key
			try {
				settingsToSave.openaiApiKey = await EncryptionUtil.encrypt(settingsToSave.openaiApiKey);
				settingsToSave.openaiApiKeyEncrypted = true;
			} catch {
				// Save unencrypted if encryption fails
				settingsToSave.openaiApiKeyEncrypted = false;
			}
		} else if (settingsToSave.openaiApiKey && settingsToSave.openaiApiKeyEncrypted) {
			// Already encrypted, re-encrypt for safety
			try {
				settingsToSave.openaiApiKey = await EncryptionUtil.encrypt(this.settings.openaiApiKey);
			} catch {
				// If encryption fails, keep the original key
			}
		}

		await this.saveData(settingsToSave);

		// Update MindMapService with new settings
		this.mindMapService.updateSettings(this.settings, this.aiClient);
	}

	async loadStyles() {
		// Styles are automatically loaded by Obsidian from styles.css
		// No dynamic style loading needed
	}

	// Replace current view with mind map view
	async replaceWithMindMapView(file: TFile) {
		// Get the active view and its leaf
		const activeView = this.app.workspace.getActiveViewOfType(FileView);

		if (activeView && activeView.leaf) {
			// Use the leaf from the active view
			await activeView.leaf.setViewState({
				type: MIND_MAP_VIEW_TYPE,
				active: true,
				state: { file: file.path }
			});
		} else {
			// Fallback: try to get a leaf through the active editor
			const activeEditor = this.app.workspace.activeEditor;
			// Type assertion for Obsidian API compatibility
			const editorView = activeEditor as { leaf?: WorkspaceLeaf };
			const leaf = editorView?.leaf || this.app.workspace.getMostRecentLeaf();

			if (leaf) {
				await leaf.setViewState({
					type: MIND_MAP_VIEW_TYPE,
					active: true,
					state: { file: file.path }
				});
			}
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(MIND_MAP_VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: MIND_MAP_VIEW_TYPE, active: true });
		}

		// "Reveal" the leaf so it is visible to the user
		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	// Create a new mindmap file with default name
	async createNewMindMapFile(contextFile?: TAbstractFile) {
		try {
			// Determine the target folder path
			let targetFolderPath = '';

			if (contextFile) {
				// Check if it's a TFile
				if (contextFile instanceof TFile) {
					// For files, use the parent folder path
					targetFolderPath = contextFile.parent?.path || '';
				}
				// Check if it's a TFolder
				else if (contextFile instanceof TFolder) {
					// For folders, use the folder's own path as the target
					targetFolderPath = contextFile.path;
				}
			}

			// Generate default filename with auto-increment if exists
			let fileName = 'Untitled mindmap.md';
			let counter = 1;

			// Construct the full file path (normalized)
			let fullPath = normalizePath(
				targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName
			);

			// Keep trying until we find a filename that doesn't exist in the target folder
			while (this.app.vault.getAbstractFileByPath(fullPath)) {
				fileName = `Untitled mindmap ${counter}.md`;
				fullPath = normalizePath(
					targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName
				);
				counter++;
			}

			// Create the file with #mindmap identifier only
			const content = '#mindmap\n';
			await this.app.vault.create(fullPath, content);

			// Get the created file
			const newFile = this.app.vault.getAbstractFileByPath(fullPath);

			if (newFile instanceof TFile) {
				// Open in new tab (like Obsidian's "New note" does)
				// The file-open event will trigger and auto-convert to mindmap view
				await this.app.workspace.getLeaf("tab").openFile(newFile);

				// Show success notice
				const message = this.messages.format(
					this.messages.notices.fileCreated,
					{ fileName: fullPath }
				);
				new Notice(message);
			} else {
				new Notice(this.messages.notices.fileCreateFailed);
			}
		} catch (error) {
			const message = this.messages.format(
				this.messages.notices.fileCreateError,
				{ error: error instanceof Error ? error.message : String(error) }
			);
			new Notice(message);
		}
	}
}


// ============================================================================
// 3. 脑图布局算法模块 (LayoutAlgorithm)
// ============================================================================

// 从 mindmap-core.ts 导入接口和功能

class MindMapView extends ItemView {
	filePath: string | null = null;
	private needsContentLoading = false;
	private isStateLoaded = false;
	private renderer: MindMapRenderer;
	private mindMapData: MindMapData | null = null;
	private mindMapService: MindMapService;
	private config: MindMapConfig;
	private updateTimer: NodeJS.Timeout | null = null;

	constructor(leaf: WorkspaceLeaf, mindMapService: MindMapService, config: MindMapConfig) {
		super(leaf);
		this.mindMapService = mindMapService;
		this.config = config;

		// Initialize i18n
		const i18nManager = createI18nManager(config.language);
		const messages = i18nManager.getMessages();

		// Use RendererManager instead of D3TreeRenderer
		// RendererManager will select DesktopTreeRenderer or MobileTreeRenderer based on config.isMobile
		// Pass isActiveView callback to prevent keyboard shortcuts from affecting other views
		this.renderer = new RendererManager(this.app, config, mindMapService, messages, () => this.isActiveView());
	}

	getViewType() {
		return MIND_MAP_VIEW_TYPE;
	}

	getDisplayText() {
		let filePath = this.filePath;

		// 如果 filePath 为 null，尝试主动获取
		if (!filePath) {
			// 尝试从 leaf state 获取
			try {
				const leafState = this.leaf.getViewState();
				if (leafState.state?.file) {
					filePath = leafState.state.file as string;
					// 缓存到实例变量
					this.filePath = filePath;
				}
			} catch {
				// 忽略错误
			}

			// 如果仍然没有，尝试从当前活跃文件获取
			if (!filePath) {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === 'md') {
					filePath = activeFile.path;
					this.filePath = filePath;
				}
			}
		}

		// 如果获取到了文件路径，返回文件名
		if (filePath) {
			// Try to get file object to extract basename (filename without extension)
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				return file.basename;
			}

			// Fallback: extract basename from path
			const fileName = filePath.split('/').pop();
			if (fileName) {
				return fileName.replace('.md', '');
			}
		}

		// Final fallback
		return "Open mindmap";
	}

	getIcon() {
		return "brain";
	}

	/**
	 * 检查此脑图视图是否为当前活动视图
	 * 用于防止快捷键在其他视图中生效
	 */
	isActiveView(): boolean {
		// 获取当前活动的 MindMapView
		const activeView = this.app.workspace.getActiveViewOfType(MindMapView);
		// 如果当前活动的 MindMapView 就是 this，则返回 true
		return activeView === this;
	}

	// Override these methods to properly handle view state
	getState() {
		return {
			file: this.filePath
		};
	}

	setState(state: { file?: string }, result: ViewStateResult) {
		this.filePath = state.file || null;
		this.isStateLoaded = true;

		// Fallback: if state.file is empty, try to get it from leaf state
		if (!this.filePath) {
			try {
				const leafState = this.leaf.getViewState();
				if (leafState.state?.file) {
					// Type assertion: we know file is a string when it exists
					this.filePath = leafState.state.file as string;
				}
			} catch {
				// Leaf might not be available yet, ignore error
			}
		}

		// If content loading was deferred and we now have a file path, load it
		if (this.needsContentLoading && this.filePath) {
			// Use setTimeout to avoid potential race conditions
			setTimeout(() => {
				void this.loadFileContent();
			}, 10);
		}

		return Promise.resolve();
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		// Add basic styling
		container.addClass('mind-map-container');

		// Show loading interface
		container.createEl("h4", { text: "Loading mind map..." });
		container.createEl("p", { text: "Initializing..." });

		// Set up callbacks for renderer
		this.renderer.onTextChanged = (node, newText) => this.handleNodeTextChanged(node, newText);
		this.renderer.onDataUpdated = () => this.handleDataUpdated();
		this.renderer.onDataRestored = (data) => this.handleDataRestored(data);

		// 清空历史记录（加载新视图时）
		this.clearHistory();

		// Set flag to indicate content loading is needed
		this.needsContentLoading = true;

		// Try to load content if state is already available
		if (this.filePath) {
			await this.loadFileContent();
		}
	}

	async loadFileContent() {
		const container = this.containerEl.children[1];
		container.empty();

		// Show loading status
		container.createEl("h4", { text: "🧠 mind map" });
		const statusEl = container.createEl("p", { text: "Loading file..." });

		// Try to get file path from multiple sources
		let filePath = this.filePath; // First try instance variable

		if (!filePath) {
			// Try getting from view state
			const state = this.leaf.getViewState();
			// Type assertion: we know file is a string when it exists
			filePath = (state.state?.file as string | undefined) || null;
		}

		if (!filePath) {
			// Try getting from active file (final fallback)
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.extension === 'md') {
				try {
					const content = await this.app.vault.read(activeFile);
					if (content.trim().startsWith('#mindmap')) {
						filePath = activeFile.path;
					}
				} catch {
					// Ignore errors reading file
				}
			}
		}

		// Update instance variable
		this.filePath = filePath;

		if (!this.filePath) {
			statusEl.textContent = "No mind map file found";

			const errorDiv = container.createDiv("mind-map-error");
			errorDiv.createEl("strong", { text: "Error:" });
			errorDiv.createEl("br");
			errorDiv.createSpan({ text: "No mind map file specified or found." });
			errorDiv.createEl("br");
			errorDiv.createEl("br");
			errorDiv.createEl("small", { text: "Make sure the file starts with #mindmap" });

			// Show debug info
			const debugInfo = container.createEl("div", { cls: "mind-map-debug" });
			debugInfo.createEl("strong", { text: "Debug info:" });
			debugInfo.createEl("br");
			debugInfo.createSpan({ text: `Instance filePath: ${this.filePath}` });
			debugInfo.createEl("br");
			debugInfo.createSpan({ text: `State loaded: ${this.isStateLoaded}` });
			debugInfo.createEl("br");
			debugInfo.createSpan({ text: `Active file: ${this.app.workspace.getActiveFile()?.path || 'none'}` });
			return;
		}

		// Reset the needs content loading flag
		this.needsContentLoading = false;

		try {
			statusEl.textContent = `Loading: ${this.filePath}`;

			const file = this.app.vault.getAbstractFileByPath(this.filePath);

			if (file instanceof TFile) {
				statusEl.textContent = "Parsing content...";

				const content = await this.mindMapService.getFileHandler().loadFileContent(file);

				// Clear loading status
				container.empty();
				await this.renderMindMap(content);
			} else {
				statusEl.textContent = `Error: File not found: ${this.filePath}`;
			}
		} catch (error) {
			statusEl.textContent = `Error loading file: ${error instanceof Error ? error.message : String(error)}`;

			const errorDiv = container.createDiv("mind-map-error");
			errorDiv.createEl("strong", { text: "Error:" });
			errorDiv.createEl("br");
			errorDiv.createSpan({ text: error instanceof Error ? error.message : String(error) });
		}
	}

	renderMindMap(content: string): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		// 数据层：构建节点关系（使用 MindMapService）
		const mindMapData = this.mindMapService.parseMarkdownToData(content, this.filePath || '');

		// 保存数据引用以便编辑时使用
		this.mindMapData = mindMapData;

		// 渲染层：使用渲染器进行可视化
		this.renderer.render(container, mindMapData);

		return Promise.resolve();
	}

	
	
	// 处理节点文本变化（带防抖优化）
	private handleNodeTextChanged(node: d3.HierarchyNode<MindMapNode>, newText: string): void {

		if (!this.mindMapData || !this.filePath) {
			return;
		}

		// 立即更新内存数据
		node.data.text = newText;

		// 防抖：清除旧的定时器
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}

		// 设置新的定时器（300ms后批量更新）
		this.updateTimer = setTimeout(() => {
			// 完全重新渲染（确保布局正确）
			// Note: View state is automatically saved by RendererCoordinator internally
			this.refreshMindMapLayout();

			// 保存文件
			if (this.filePath && this.mindMapData?.rootNode) {
				void this.mindMapService.saveToMarkdownFile(this.filePath, this.mindMapData.rootNode);
			}

			// 清空定时器引用
			this.updateTimer = null;
		}, 300);
	}

	// 处理数据更新（新增节点时调用）
	private handleDataUpdated(): void {
		if (!this.mindMapData || !this.filePath) return;

		// 重新生成数据结构确保一致性
		const rootNode = this.mindMapData.rootNode;
		if (rootNode) {
			// 重新渲染脑图
			this.refreshMindMapLayout();

			// 异步保存到文件
			void this.mindMapService.saveToMarkdownFile(this.filePath, rootNode);
		}
	}

	// 处理数据恢复（undo/redo 时调用）
	private handleDataRestored(data: MindMapData): void {

		// ✅ 关键修复：直接更新 mindMapData 引用
		// 这样 refreshMindMapLayout() 就会使用恢复后的数据
		this.mindMapData = data;

		// 重新渲染脑图
		this.refreshMindMapLayout();

		// 异步保存到文件
		if (this.filePath && data.rootNode) {
			void this.mindMapService.saveToMarkdownFile(this.filePath, data.rootNode);
		}
	}

	// 刷新思维导图布局（优化版）
	private refreshMindMapLayout(): void {
		if (!this.mindMapData || !this.renderer) return;

		try {
			// Note: View state is automatically saved by RendererCoordinator internally

			// 获取当前容器元素
			const container = this.containerEl.children[1];
			if (!container) return;

			// 使用 requestAnimationFrame 确保在下一次渲染帧中执行，避免视觉跳跃
			requestAnimationFrame(() => {
				// 清空当前渲染内容
				container.empty();

				// 重新渲染整个思维导图（这会自动恢复之前保存的视图状态）
				this.renderer.render(container, this.mindMapData);
			});
		} catch {
			// Ignore errors during state restoration
		}
	}

	// ========== Undo/Redo 方法 ==========

	/**
	 * 撤销上一次操作
	 */
	public undo(): void {
		if (this.renderer instanceof RendererCoordinator) {
			const success = this.renderer.undo();
			if (success) {
				new Notice('已撤销');
			}
		}
	}

	/**
	 * 重做上一次撤销的操作
	 */
	public redo(): void {
		if (this.renderer instanceof RendererCoordinator) {
			const success = this.renderer.redo();
			if (success) {
				new Notice('已重做');
			}
		}
	}

	/**
	 * 清空历史记录（加载新文件时调用）
	 */
	public clearHistory(): void {
		if (this.renderer instanceof RendererCoordinator) {
			this.renderer.clearHistory();
		}
	}


	onClose(): Promise<void> {
		// 清理防抖定时器
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}

		// 销毁渲染器，清理全局键盘监听器
		// 这对于防止快捷键干扰其他视图非常重要
		if (this.renderer) {
			this.renderer.destroy();
		}

		// Note: Edit state is automatically cleaned up by NodeEditor internally

		return Promise.resolve();
	}
}

class MindMapSettingTab extends PluginSettingTab {
	plugin: MindMapPlugin;
	private testButtonHandler: (() => Promise<void>) | null = null;
	private testButton: HTMLButtonElement | null = null;

	constructor(app: App, plugin: MindMapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Clean up event listener when settings tab is hidden
		if (this.testButton && this.testButtonHandler) {
			// eslint-disable-next-line @typescript-eslint/no-misused-promises -- async handler is intentionally used as event listener
			this.testButton.removeEventListener('click', this.testButtonHandler);
			this.testButton = null;
			this.testButtonHandler = null;
		}
	}

	display(): void {
		const {containerEl} = this;

		// Clean up previous event listener
		if (this.testButton && this.testButtonHandler) {
			// eslint-disable-next-line @typescript-eslint/no-misused-promises -- async handler is intentionally used as event listener
			this.testButton.removeEventListener('click', this.testButtonHandler);
			this.testButton = null;
			this.testButtonHandler = null;
		}

		containerEl.empty();

		new Setting(containerEl).setName('Main').setHeading();

		// ====================
		// Device Type Settings
		// ====================
		new Setting(containerEl).setName('Device').setHeading();

		new Setting(containerEl)
			.setName('Device type')
			.setDesc('Choose how content should be rendered. Auto-detects based on your device.')
			.addDropdown(dropdown => dropdown
				.addOption('auto', 'Auto-detect')
				.addOption('desktop', 'Desktop mode')
				.addOption('mobile', 'Mobile mode')
				.setValue(this.plugin.settings.deviceType)
				.onChange((value: 'auto' | 'mobile' | 'desktop') => {
					void (async () => {
						this.plugin.settings.deviceType = value;
						await this.plugin.saveSettings();
						// Show notice about reloading
						new Notice(this.plugin.messages.notices.deviceTypeChanged);
					})();
				}));

		// ====================
		// Language Settings
		// ====================
		new Setting(containerEl).setName('Language').setHeading();

		new Setting(containerEl)
			.setName('Language')
			.setDesc('Choose your preferred language for the plugin interface.')
			.addDropdown(dropdown => dropdown
				.addOption('en', 'English')
				.addOption('zh', '中文')
				.setValue(this.plugin.settings.language || 'en')
				.onChange((value: 'en' | 'zh') => {
					void (async () => {
						this.plugin.settings.language = value;
						await this.plugin.saveSettings();

						// Update config and service layer with new language
						this.plugin.configManager.updateLanguage(value);
						this.plugin.config.language = value;
						this.plugin.mindMapService.updateLanguage(value);

						// Reload the settings page to apply language change
						this.display();

						// Create new i18n manager with the new language to show notice in the correct language
						const newI18nManager = createI18nManager(value);
						const newMessages = newI18nManager.getMessages();

						// Show language change notice in the NEW language
						const languageName = value === 'en' ? 'English' : '中文';
						const message = newMessages.format(
							newMessages.notices.languageChanged,
							{ language: languageName }
						);
						new Notice(message);
					})();
				}));

		// ====================
		// AI Configuration
		// ====================
		new Setting(containerEl).setName('AI configuration').setHeading();
		containerEl.createEl('p', {
			text: 'Configure your AI API to enable intelligent features like automatic node suggestions.',
			cls: 'setting-item-description'
		});

		// Security notice
		const securityNotice = containerEl.createDiv({ cls: 'setting-item-security-notice' });
		securityNotice.createEl('strong', { text: '🔒 security:' });
		securityNotice.appendText(' Your api key is encrypted using AES-GCM (256-bit) before storage. ');
		const codeEl = securityNotice.createEl('code', { text: 'Data.json' });
		securityNotice.appendText(' The encrypted key is stored in ');
		securityNotice.appendChild(codeEl.cloneNode(true));
		securityNotice.appendText(' and can only be decrypted on this device.');

		// API Base URL
		new Setting(containerEl)
			.setName('OpenAI API base URL')
			.setDesc('the base URL for your OpenAI-compatible API (e.g., https://api.openai.com/v1)')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.openaiApiBaseUrl)
				.onChange((value) => {
					void (async () => {
						this.plugin.settings.openaiApiBaseUrl = value;
						await this.plugin.saveSettings();
					})();
				}));

		// API Key
		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your API key')
			.addText(text => {
				text.setPlaceholder('sk-...');
				text.setValue(this.plugin.settings.openaiApiKey);
				text.inputEl.type = 'password'; // Set input type to password
				text.onChange((value: string) => {
					void (async () => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();
						// Update AI client with new key
						this.plugin.aiClient.updateConfig({
							apiBaseUrl: this.plugin.settings.openaiApiBaseUrl,
							apiKey: value,
							model: this.plugin.settings.openaiModel
						});
					})();
				});
			});

		// Model Name
		new Setting(containerEl)
			.setName('Model name')
			.setDesc('The model name to use (e.g., gpt-3.5-turbo, gpt-4, llama2, mistral, etc.)')
			.addText(text => text
				.setPlaceholder('gpt-3.5-turbo')
				.setValue(this.plugin.settings.openaiModel)
				.onChange((value: string) => {
					void (async () => {
						this.plugin.settings.openaiModel = value;
						await this.plugin.saveSettings();
						// Update AI client with new model
						this.plugin.aiClient.updateConfig({
							apiBaseUrl: this.plugin.settings.openaiApiBaseUrl,
							apiKey: this.plugin.settings.openaiApiKey,
							model: value
						});
					})();
				}));

		// Test Connection Button
		const testButtonContainer = containerEl.createDiv({ cls: 'setting-item' });
		const testButtonDesc = testButtonContainer.createDiv({ cls: 'setting-item-info' });
		testButtonDesc.createDiv({ cls: 'setting-item-name', text: 'Test connection' });
		testButtonDesc.createDiv({ cls: 'setting-item-description', text: 'Test your API configuration to ensure it works correctly' });

		const testButtonControl = testButtonContainer.createDiv({ cls: 'setting-item-control' });

		// Store reference to button for cleanup
		this.testButton = testButtonControl.createEl('button', {
			text: 'Test connection',
			cls: 'mod-cta'
		});

		// Result message element
		let resultEl: HTMLElement | null = null;

		// Test connection button handler - store reference for cleanup
		this.testButtonHandler = async () => {
			// Remove previous result if exists
			if (resultEl) {
				resultEl.remove();
			}

			// Update button state
			this.testButton.textContent = 'Testing...';
			this.testButton.disabled = true;

			try {
				// Add 10 second timeout
				const TIMEOUT_MS = 10000;

				const testPromise = this.plugin.aiClient.testConnection();

				// Create timeout promise
				const timeoutPromise = new Promise<TestConnectionResult>((_, reject) => {
					setTimeout(() => {
						reject(new Error(this.plugin.messages.notices.apiTestTimeout));
					}, TIMEOUT_MS);
				});

				// Race between test and timeout
				const result = await Promise.race([testPromise, timeoutPromise]);

				// Create result element
				resultEl = testButtonControl.createDiv({
					cls: `ai-test-result ${result.success ? 'success' : 'error'}`
				});
				resultEl.textContent = result.message;

				// Show notice
				if (result.success) {
					new Notice(this.plugin.messages.notices.apiConnectionSuccess);
				} else {
					new Notice(this.plugin.messages.notices.apiConnectionFailed);
				}
			} catch (error) {
				// Handle unexpected errors and timeout
				const errorMessage = error instanceof Error ? error.message : String(error);
				resultEl = testButtonControl.createDiv({
					cls: 'ai-test-result error'
				});
				resultEl.textContent = `❌ Error: ${errorMessage}`;
				new Notice(this.plugin.messages.notices.connectionTestFailed);
			} finally {
				// Restore button state
				if (this.testButton) {
					this.testButton.textContent = 'Test connection';
					this.testButton.disabled = false;
				}
			}
		};

		// eslint-disable-next-line @typescript-eslint/no-misused-promises -- async handler is intentionally used as event listener
		this.testButton.addEventListener('click', this.testButtonHandler);

		// AI Prompts Configuration
		new Setting(containerEl).setName('AI prompt configuration').setHeading();
		containerEl.createEl('p', {
			text: 'Customize how the AI generates suggestions by editing the system message and prompt template.',
			cls: 'setting-item-description'
		});

		// System Message
		new Setting(containerEl)
			.setName('AI system message')
			.setDesc('Define the AI assistant role and behavior. This sets the context for all AI interactions.')
			.addTextArea(text => {
				text.setPlaceholder('You are a helpful mind map assistant...');
				text.setValue(this.plugin.settings.aiSystemMessage);
				text.onChange((value) => {
					void (async () => {
						this.plugin.settings.aiSystemMessage = value;
						await this.plugin.saveSettings();
					})();
				});
			});

		// Prompt Template
		new Setting(containerEl)
			.setName('AI prompt template')
			.setDesc('Customize the prompt template for node suggestions. Available variables: {nodeText}, {level}, {parentContext}, {siblingsContext}, {existingChildren}, {centralTopic}')
			.addTextArea(text => {
				text.setPlaceholder('Please suggest 3-5 child nodes...');
				text.setValue(this.plugin.settings.aiPromptTemplate);
				text.onChange((value) => {
					void (async () => {
						this.plugin.settings.aiPromptTemplate = value;
						await this.plugin.saveSettings();
					})();
				});
			});

		// Variables Reference
		const variablesRef = containerEl.createDiv({ cls: 'prompt-variables-reference' });
		variablesRef.createEl('strong', { text: 'Available variables:' });

		const ul = variablesRef.createEl('ul');
		const variables = [
			{ code: '{nodeText}', desc: 'Current node text' },
			{ code: '{level}', desc: 'Node hierarchy level (0=root)' },
			{ code: '{parentContext}', desc: 'Parent node info (if exists)' },
			{ code: '{siblingsContext}', desc: 'Sibling nodes (if exists)' },
			{ code: '{existingChildren}', desc: 'Already existing children' },
			{ code: '{centralTopic}', desc: 'Central topic (root node text)' }
		];

		for (const v of variables) {
			const li = ul.createEl('li');
			li.createEl('code', { text: v.code });
			li.appendText(` - ${v.desc}`);
		}

		// Reset Prompts Button
		new Setting(containerEl)
			.setName('Reset prompts')
			.setDesc('Reset prompt templates to default values')
			.addButton(button => button
				.setButtonText('Reset to defaults')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.aiSystemMessage = DEFAULT_SETTINGS.aiSystemMessage;
					this.plugin.settings.aiPromptTemplate = DEFAULT_SETTINGS.aiPromptTemplate;
					await this.plugin.saveSettings();

					// Reload the settings page to show updated values
					this.display();
					new Notice(this.plugin.messages.notices.promptsReset);
				}));
	}
}