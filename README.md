# 🌍 Spring i18n Ally

> **Your ultimate companion for Spring Boot Internationalization.**  
> *Visualize, Manage, and Translate property keys directly within VS Code.*

[![Version](https://img.shields.io/badge/version-0.2.2-blue?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=comnori.spring-i18n-ally)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE.md)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/comnori.spring-i18n-ally?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=comnori.spring-i18n-ally)

---

## 🚀 Why Spring i18n Ally?

Managing `messages.properties` or `messages.yml` files manually is painful. context switching between Java code and resource files breaks your flow. 

**Spring i18n Ally** eliminates this friction by bringing translation data **directly into your code editor**.

*   **Stop guessing** what `"error.login.failed"` means.
*   **Stop searching** for the right key in massive property files.
*   **Stop switching** windows to translate or add new keys.

---

## ✨ Key Features

### 👁️ Enhanced Coding Experience
*   **Inline Decorations**: Translations appear right next to the keys in your Java code. No more hovering just to check a value.
*   **Rich Hover Support**: Hover over a key to see translations in *all* configured locales, with clickable links to jump to the source file.

### 🛠️ Powerful Management Tools
*   **i18n Explorer**: A dedicated Sidebar Tree View to browse your entire key hierarchy (`user` > `login` > `title`).
*   **Translation Editor**: A visual editor to manage all locales side-by-side.
    *   ✨ **Google Translate Integration**: Auto-fill missing translations with a single click.
    *   ✨ **Validation**: Easily spot missing values.

### ⚡ Productivity Boosters
*   **Extract Key Command**: Select any string literal in your code -> Right Click -> "Extract to i18n Key". It automatically creates the key and replaces the string.
*   **Smart Search**: Filter keys instantly in the explorer.
*   **Flexible Config**: Works with `.properties` and `.yaml`. Customizable Regex for non-standard key patterns.

---

## ⚙️ Configuration

Customize the extension in your VS Code `settings.json`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `springI18n.locales` | `["ko", "en"]` | Priority list of locales to show in decorations. |
| `springI18n.viewLocale` | `""` | Force a specific locale for inline preview (overrides priority). |
| `springI18n.keyRegex` | `See VSCode` | Regex to identify keys (e.g., custom formats). |

---

## 📦 Installation & Usage

1.  **Install** the extension from the VS Code Marketplace.
2.  **Open** any Spring Boot project.
3.  The extension automatically scans `src/main/resources` for `messages*.properties` or `*.yml`.
4.  **Enjoy!** Open a Java file to see inline translations immediately.

> **Tip**: Click the 🌐 icon in the Status Bar to quickly switch the active display locale.

---

## 🗺️ Roadmap

We are constantly improving!

- [x] **Inline Preview & Hover**
- [x] **Tree View Explorer**
- [x] **Visual Translation Editor**
- [x] **Google Translate Auto-fill**
- [x] **Key Extraction from Code**
- [ ] **Code Lens**: "Edit" buttons directly above keys in Java files.
- [ ] **Linting**: Warning for unused keys or missing translations.

---

## 🤝 Support & Contribution

Found a bug? Have a feature request?

*   [Report an Issue](https://github.com/comnori/spring-i18n-ally/issues)
*   [Contribute Code](https://github.com/comnori/spring-i18n-ally)

**Love the extension? Support the development!**

<a href="https://www.buymeacoffee.com/comnori">
  <img src="https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" />
</a>
<a href="https://patreon.com/comnori">
  <img src="https://img.shields.io/badge/Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white" alt="Patreon" />
</a>

---

## 💡 Inspiration

This extension is inspired by the amazing [i18n-ally](https://github.com/lokalise/i18n-ally) by Lokalise. While `i18n-ally` is fantastic for general web development, **Spring i18n Ally** focuses specifically on the **Java/Spring Boot ecosystem**, providing specialized support for backend property workflows.

---

**Author**: [Yongsik Yun](https://www.linkedin.com/in/yongsik-yun-36260344)  
**License**: MIT
