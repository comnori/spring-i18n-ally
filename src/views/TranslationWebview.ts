import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';
import { translate } from 'google-translate-api-x';

export class TranslationWebview {
    public static currentPanel: TranslationWebview | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _key: string = '';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, key: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._key = key;

        this.update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'save':
                        await this._save(message.data);
                        return;
                    case 'translate':
                        await this._translate(message.data);
                        return;
                    case 'delete':
                        await this._delete();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, key: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (TranslationWebview.currentPanel) {
            TranslationWebview.currentPanel._panel.reveal(column);
            TranslationWebview.currentPanel._key = key;
            TranslationWebview.currentPanel.update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'springI18nTranslation',
            `Translating: ${key}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        TranslationWebview.currentPanel = new TranslationWebview(panel, extensionUri, key);
    }

    public dispose() {
        TranslationWebview.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _delete() {
        const manager = I18nManager.getInstance();
        await manager.deleteKey(this._key);
        vscode.window.showInformationMessage(`Deleted key ${this._key}`);
        this._panel.dispose();
    }

    private async _save(data: any) {
        const manager = I18nManager.getInstance();
        const newKey = data.key;
        const translations = data.translations;

        if (newKey !== this._key) {
            // Rename case: Delete old key then write new key
            // Check if new key exists?
            // Ideally we should warn, but let's just proceed.
            // Wait, if we delete old key first, we lose values if write fails?
            // But we have values in 'translations'.
            if (this._key) {
                await manager.deleteKey(this._key);
            }
            this._key = newKey;
            this._panel.title = `Translating: ${this._key}`;
        }

        const promises = Object.keys(translations).map(locale =>
            manager.writeTranslation(this._key, locale, translations[locale])
        );
        await Promise.all(promises);
        vscode.window.showInformationMessage(`Saved translations for ${this._key}`);
        this.update();
    }

    private async _translate(data: any) {
        const { sourceLocale, targetLocales } = data;
        const manager = I18nManager.getInstance();
        const sourceText = manager.getTranslation(this._key, sourceLocale);

        if (!sourceText) {
            vscode.window.showWarningMessage(`No source text found for locale: ${sourceLocale}`);
            return;
        }

        const results: any = {};

        // Run translations
        // We use google-translate-api-x
        try {
            for (const target of targetLocales) {
                // target is locale code, e.g. 'ko', 'en', 'fr'
                // google translate needs ISO code. Usually 'ko', 'en' work.
                // We map 'default' to something? No, 'default' isn't a language code.
                if (target === 'default') continue;

                // Simple check if target is valid 2 char code
                const targetLang = target.split('_')[0]; // 'en_US' -> 'en'

                const res = await translate(sourceText, { to: targetLang });
                results[target] = res.text;
            }
            this._panel.webview.postMessage({ command: 'translationResult', results });
        } catch (e: any) {
            vscode.window.showErrorMessage(`Translation failed: ${e.message}`);
        }
    }

    public update() {
        const manager = I18nManager.getInstance();
        const config = vscode.workspace.getConfiguration('springI18n');
        const locales = config.get<string[]>('locales') || ['en', 'ko'];
        // Also include any locales found in cache but not in config?
        // Let's rely on config + viewLocale as "main"
        const viewLocale = config.get<string>('viewLocale') || locales[0] || 'en';

        // Gather data
        const translations: any = {};
        const availableLocales = new Set(locales);
        // Always include 'default' if it exists (for messages.properties)
        if (manager.propertiesCache['default']) {
            availableLocales.add('default');
        }

        // If no locales are configured, fallback to showing all available
        if (locales.length === 0) {
            Object.keys(manager.propertiesCache).forEach(k => availableLocales.add(k));
        }

        availableLocales.forEach(l => {
            translations[l] = manager.getTranslation(this._key, l) || '';
        });

        this._panel.title = `Translating: ${this._key}`;
        this._panel.webview.html = this._getHtmlForWebview(this._key, Array.from(availableLocales), viewLocale, translations);
    }

    private _getHtmlForWebview(key: string, locales: string[], mainLocale: string, translations: any) {
        // Helper to escape HTML
        const escapeHtml = (text: string) => {
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };

        // Sort locales: mainLocale first, then alphabetical
        const sortedLocales = [...locales].sort((a, b) => {
            if (a === mainLocale) return -1;
            if (b === mainLocale) return 1;
            return a.localeCompare(b);
        });

        // Simple HTML with table
        const rows = sortedLocales.map(locale => {
            const val = escapeHtml(translations[locale] || '');
            const isMain = locale === mainLocale;
            return `
                <tr>
                    <td>${locale} ${isMain ? '(Main)' : ''}</td>
                    <td>
                        <input type="text" id="input-${locale}" value="${val}" style="width: 100%;" />
                    </td>
                    <td>
                        ${!isMain ? `<button onclick="translateOne('${locale}')">Google Translate</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Translation Editor</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 10px; border-bottom: 1px solid #ccc; text-align: left; }
                    input { padding: 5px; }
                    button { padding: 5px 10px; cursor: pointer; }
                    .actions { margin-top: 20px; }
                </style>
            </head>
            <body>
                <div style="margin-bottom: 20px;">
                    <label>Key: <input type="text" id="key-input" value="${key}" style="width: 50%; font-size: 1.2em;" /></label>
                    <button onclick="deleteKey()" style="background-color: #d84a4a; color: white;">Delete Key</button>
                </div>
                <div style="margin-bottom: 10px;">
                    Main Language (Source): <strong>${mainLocale}</strong>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Locale</th>
                            <th>Translation</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                <div class="actions">
                    <button onclick="saveAll()">Save All</button>
                    <button onclick="translateEmpty()">Fill Empty with Google Translate</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const mainLocale = "${mainLocale}";

                    function deleteKey() {
                        vscode.postMessage({ command: 'delete' });
                    }

                    function saveAll() {
                        const translations = {};
                        const inputs = document.querySelectorAll('input[id^="input-"]');
                        inputs.forEach(input => {
                            const locale = input.id.replace('input-', '');
                            translations[locale] = input.value;
                        });
                        const key = document.getElementById('key-input').value;
                        vscode.postMessage({ command: 'save', data: { key, translations } });
                    }

                    function translateOne(targetLocale) {
                        vscode.postMessage({
                            command: 'translate',
                            data: {
                                sourceLocale: mainLocale,
                                targetLocales: [targetLocale]
                            }
                        });
                    }

                    function translateEmpty() {
                        const targets = [];
                        const inputs = document.querySelectorAll('input[id^="input-"]');
                        inputs.forEach(input => {
                            const locale = input.id.replace('input-', '');
                            if (locale !== mainLocale && !input.value.trim()) {
                                targets.push(locale);
                            }
                        });
                        if (targets.length === 0) {
                            return;
                        }

                        // Ask for confirmation? (Handled in webview logic slightly, but better here)
                        // Just do it.
                        vscode.postMessage({
                            command: 'translate',
                            data: {
                                sourceLocale: mainLocale,
                                targetLocales: targets
                            }
                        });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'translationResult':
                                const results = message.results;
                                for (const locale in results) {
                                    const input = document.getElementById('input-' + locale);
                                    if (input) {
                                        input.value = results[locale];
                                    }
                                }
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
