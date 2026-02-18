# openMindMap v1.0.0 Release Notes

## 🎉 Initial Release

We're excited to announce the first official release of **openMindMap** - a powerful Obsidian plugin that automatically renders Markdown files as interactive D3.js mind maps!

## ✨ Highlights

- **Automatic Detection**: Files starting with `#mindmap` are instantly converted to interactive mind maps
- **AI-Powered Suggestions**: Get intelligent node content suggestions using any OpenAI-compatible API
- **Cross-Platform Support**: Optimized for both desktop and mobile devices with touch interactions
- **Enterprise-Grade Security**: AES-256 encryption for API keys with device-bound key derivation

## 🚀 Core Features

### Automatic Detection and Conversion
- Automatically identifies Markdown files that begin with `#mindmap`
- Seamlessly replaces the Markdown editor with an interactive mind map view
- Supports standard Markdown list syntax conversion to tree structure

### Interactive D3.js Visualization
- Powerful rendering engine based on D3.js 7.x
- Smooth animation transition effects
- Responsive layout with automatic node position calculation
- Beautiful Bézier curve connectors

### Rich Interactive Operations
- **Node Editing**: Double-click nodes to edit content
- **Node Management**: Add, delete, copy nodes
- **Canvas Zoom**: Mouse wheel zoom (desktop) or pinch gestures (mobile)
- **Canvas Panning**: Drag canvas with mouse (desktop) or touch (mobile)
- **Node Selection**: Highlight selected nodes and their paths

### Perfect Theme Adaptation
- Automatically reads CSS variables from Obsidian's current theme
- Perfect integration with dark/light themes
- Automatic adaptation of node colors, text colors, and background colors
- Maintains consistency with the Obsidian interface

### AI Smart Suggestions 🤖
- **AI-driven node content suggestions**: Intelligently analyzes node content to generate relevant suggestions
- **OpenAI-Compatible API Support**: Works with OpenAI, Anthropic, local models, or any compatible service
- **Context-Aware**: Analyzes node hierarchy, parent nodes, sibling nodes, and existing content
- **Flexible Addition**: Click individual suggestions or add all at once
- **Fully Customizable**: Customizable AI system prompts and prompt templates

### Security and Privacy 🔒
- **AES-GCM 256-bit encryption** for API keys
- **PBKDF2 key derivation** with 100,000 iterations
- **Device-bound keys**: Encryption keys derived from device-specific information
- **Local encrypted storage**: API keys stored securely in `data.json`

## 📦 Installation

### From Obsidian Plugin Marketplace (Recommended)
1. Open **Obsidian Settings → Community plugins**
2. Click **Browse** and search for "openMindMap"
3. Click **Install** and **Enable**

### Manual Installation
```bash
mkdir -p .obsidian/plugins/obsidian-mindmap-plugin && \
curl -L -o .obsidian/plugins/obsidian-mindmap-plugin/main.js \
  https://github.com/Hanzzh/openMindMap/releases/download/v1.0.0/main.js && \
curl -L -o .obsidian/plugins/obsidian-mindmap-plugin/manifest.json \
  https://github.com/Hanzzh/openMindMap/releases/download/v1.0.0/manifest.json && \
curl -L -o .obsidian/plugins/obsidian-mindmap-plugin/styles.css \
  https://github.com/Hanzzh/openMindMap/releases/download/v1.0.0/styles.css
```

Then enable the plugin in **Obsidian Settings → Community plugins → Installed**

## 🚀 Quick Start

### Create Your First Mind Map

Create a new Markdown file with this content:

```markdown
#mindmap

* My Project
    * Research
    * Planning
    * Development
```

Save the file and watch it transform into an interactive mind map!

### File Format Rules
- First line must be exactly `#mindmap` (no spaces before or after)
- Use standard Markdown list syntax (`*`, `-`, or `+`)
- **4 spaces per indentation level** (required)
- UTF-8 encoding

## 🤖 AI Feature Setup

AI features are completely optional. To enable:

1. Open **Settings → openMindMap Plugin Settings → AI Configuration**
2. Configure your API settings:
   - **API Base URL**: Your API endpoint (e.g., `https://api.openai.com/v1`)
   - **API Key**: Your API key (encrypted with AES-256)
   - **Model Name**: Model to use (e.g., `gpt-3.5-turbo`, `claude-3-sonnet`)
3. Click **Test Connection** to verify
4. Click the ✨ button on any node to get AI-powered suggestions

## 🎨 Customization

### Device Settings
- **Device Type**: Auto-detect or force Desktop/Mobile mode

### AI Configuration
- **API Base URL**: Your OpenAI-compatible API endpoint
- **API Key**: Encrypted storage with AES-256
- **Model Name**: Custom model selection
- **System Message**: Define AI role and behavior
- **Prompt Template**: Customize suggestion prompts with variables:
  - `{nodeText}` - Current node text
  - `{level}` - Node hierarchy level
  - `{parentContext}` - Parent node information
  - `{siblingsContext}` - Sibling nodes
  - `{existingChildren}` - Existing child nodes
  - `{centralTopic}` - Root node text

## 🛠️ Technical Specifications

- **TypeScript**: 5.9.3 with strict type safety
- **D3.js**: 7.9.0 for data visualization
- **Obsidian API**: Compatible with app version 0.15.0+
- **Architecture**: Modular service-oriented design
- **Security**: AES-GCM 256-bit + PBKDF2 (100,000 iterations)

## 📋 Network Usage

This plugin uses network connections **only** for optional AI features:
- **Purpose**: Send node context to user-configured AI APIs
- **When**: Only when clicking the AI suggestion button (✨)
- **Services**: OpenAI-compatible APIs (user-configured)
- **Data sent**: Node text, hierarchy context, parent/sibling/child nodes
- **No telemetry**: No analytics, tracking, or data collection

## 🔒 Security Notice

- API keys are encrypted with **AES-GCM 256-bit** before storage
- Encryption keys are **device-specific** using PBKDF2 derivation
- Encrypted data **cannot be decrypted on other devices**
- API keys **never leave your device** unencrypted
- Local storage only in `data.json`

## 🐛 Troubleshooting

### Common Issues

**Problem**: File doesn't convert to mind map
- **Solution**: Ensure first line is exactly `#mindmap` with no spaces

**Problem**: Mind map displays incorrectly
- **Solution**: Use 4 spaces per indentation level; Tab not supported

**Problem**: AI suggestions unavailable
- **Solution**: Check API configuration and click "Test Connection"

For detailed troubleshooting, see [README.md](TROUBLESHOOTING.md)

## 📚 Documentation

- **[README.md](README.md)**: Complete user guide and documentation
- **[CLAUDE.md](CLAUDE.md)**: Development documentation and architecture
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**: Detailed debugging guide

## 🙏 Acknowledgments

### Third-Party Libraries
- **D3.js v7.9.0** (ISC License) - Interactive data visualization
- **Obsidian API** (MIT License) - Plugin development kit

### Special Thanks
- The Obsidian team for the powerful note-taking platform
- The D3.js community for excellent visualization tools
- All users who provided feedback and testing

## 📝 License

MIT License - See [LICENSE](LICENSE) for details

## 🤝 Contributing

Issue and Pull Request contributions welcome!

For development contributions, please refer to [CLAUDE.md](CLAUDE.md) for architecture specifications and development guidelines.

## 📞 Support & Feedback

- **Bug Reports**: [GitHub Issues](https://github.com/Hanzzh/openMindMap/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/Hanzzh/openMindMap/discussions)
- **Questions**: Check [Troubleshooting](TROUBLESHOOTING.md) section first

---

**Enjoy your mind mapping journey!** 🚀✨

---

## 📋 Download Assets

- **main.js** - Compiled plugin bundle
- **manifest.json** - Plugin metadata
- **styles.css** - Plugin styles

**Minimum Obsidian Version**: 0.15.0
