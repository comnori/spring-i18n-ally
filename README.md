# Spring i18n Helper

> Boost your Spring Boot productivity: Inline i18n previews and hover details for Java properties.

![Version](https://img.shields.io/badge/version-0.0.7-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Publisher](https://img.shields.io/badge/publisher-comnori-orange?style=flat-square)
![Price](https://img.shields.io/badge/price-Free-brightgreen?style=flat-square)
[![Stars](https://img.shields.io/github/stars/comnori/spring-i18n-ally?style=social)](https://github.com/comnori/spring-i18n-ally)

---

## Introduction

Managing internationalization (i18n) in Java Spring projects can be cumbersome. Developers often stare at keys like `"user.login.title"` in their Java source code, having to manually search through multiple `.properties` files just to check the actual text or verify if a translation exists.

**Spring i18n Helper** solves this by bringing your translations directly into your Java editor. It visualizes the values right next to the keys and provides instant access to all locales, eliminating context switching and speeding up your workflow.

## Key Features

*   ✨ **Inline Preview**: Automatically detects i18n keys in your Java code and overlays the translation directly on the key.
*   🔍 **Hover Insights**: Hover over any property key to see translations for all configured locales and a quick link to the definition file.
*   📁 **Smart Property Detection**: Automatically finds property files in `src/main/resources`, nested folders, or custom locations defined in `application.properties`/`yml`.
*   🚀 **Customizable Regex**: Supports standard dot-separated keys by default, but fully configurable to match your specific project patterns via settings.
*   🌍 **Translation Editor**: Manage translations for multiple locales in a dedicated editor. Includes Google Translate integration to auto-fill missing values.
*   🌳 **i18n Explorer**: A dedicated Tree View to browse, add, edit, and delete keys easily.
*   ⚡ **Search & Navigation**: Quickly find keys with the search function in the sidebar. Includes "Expand All" and "Collapse All" for easy browsing.
*   🛠️ **Extract to Key**: Select a string literal in your code and extract it directly to a new i18n key via the context menu.

## Usage

Simply open any `.java` file in your Spring project. The extension will automatically scan for property keys and display the translations.

1.  **Open a Java file**: Keys like `"com.example.message"` are detected.
2.  **See the value**: The translation overlays the key text. Select the text to see the original key.
3.  **Hover for more**: Move your mouse over the key to see all available translations. **Click the key name** in the hover tooltip to open the Translation Editor.
4.  **Manage Keys**: Open the "Spring i18n" explorer in the Activity Bar to:
    *   **Refresh**: Reload properties files from disk.
    *   **Search**: Filter keys by name.
    *   **Add Key**: Create a new translation key globally.
    *   **Delete Key**: Remove a key and its translations from all files.
    *   **Expand/Collapse All**: Manage the tree view's visibility state.

![Demo Animation](resources/logo.png) *(Note: Demo gif to be updated)*

## Extension Settings

This extension contributes the following settings to your VS Code configuration:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `springI18n.locales` | `array` | `["ko", "en"]` | Prioritized locales to display in inline decorations. |
| `springI18n.viewLocale` | `string` | `""` | The specific locale to display in inline decorations (overrides priority list). |
| `springI18n.keyRegex` | `string` | `"([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)"` | Custom Regex to identify i18n keys. |

## Known Issues

*   **Conflict with Red Hat Java Extension**: In some environments, the hover provider might conflict with the standard Java extension (`redhat.java`). If you experience cancellation errors in logs, it is usually harmless. We have optimized our hover provider to minimize interference.

## For Contributors

Interested in contributing? Here is how to build and test the project locally.

### Build & Package

```bash
# Install dependencies
npm install

# Compile source code
npm run compile

# Watch for changes
npm run watch

# Package the extension (.vsix)
npm run package
```

### Publish

```bash
npm run publish
```

## Roadmap

We are actively working on making this the ultimate i18n tool for Spring. 

- [x] **Side Panel (Tree View)**: Browse keys hierarchically.
- [x] **Direct Editing**: Modify translations directly from the tree view.
- [x] **Key Management**: Add/Remove keys via the UI.
- [x] **Search & Filter**: Find keys quickly in the explorer.
- [x] **Extract to Key**: Context menu action to extract selected text to a property.
- [ ] **Code Lens**: Show translation counts or direct "Edit" links above keys in Java code.

## Support & Author

If you find this extension helpful, please consider supporting the development!

<a href="https://www.buymeacoffee.com/comnori">
  <img src="https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" />
</a>
&nbsp;
<a href="https://patreon.com/comnori">
  <img src="https://img.shields.io/badge/Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white" alt="Patreon" />
</a>

**Author**: [Yongsik Yun](https://www.linkedin.com/in/yongsik-yun-36260344)
📧 comnori@gmail.com

## Inspiration

This extension is inspired by [lokalise.i18n-ally](https://github.com/lokalise/i18n-ally).

## License

This project is licensed under the [MIT License](LICENSE.md).
