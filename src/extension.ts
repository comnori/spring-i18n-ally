import * as vscode from 'vscode';
import { I18nManager } from './i18nManager';
import { I18nKeyTreeProvider } from './views/I18nKeyTreeProvider';
import { editI18nKey } from './commands/editKey';
import { extractI18nKey } from './commands/extractKey';

// Constants
const DECORATION_TYPE = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 1em',
        color: 'gray',
        fontStyle: 'italic'
    }
});

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Spring i18n Helper is now active!');

    // Initialize Manager
    const manager = I18nManager.getInstance();

    // Register View Provider
    const treeProvider = new I18nKeyTreeProvider();
    vscode.window.registerTreeDataProvider('springI18nView', treeProvider);

    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.editKey', editI18nKey));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.extractKey', extractI18nKey));

    // Initialize Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Register Command to Select Locale
    const selectLocaleCommand = vscode.commands.registerCommand('springI18n.selectLocale', async () => {
        const config = vscode.workspace.getConfiguration('springI18n');
        const locales = config.get<string[]>('locales') || [];

        if (locales.length === 0) {
            vscode.window.showInformationMessage('No locales configured in springI18n.locales');
            return;
        }

        const selected = await vscode.window.showQuickPick(['Auto', ...locales], {
            placeHolder: 'Select a locale to display (Auto = use priority list)'
        });

        if (selected !== undefined) {
             const newValue = selected === 'Auto' ? '' : selected;
             await config.update('viewLocale', newValue, vscode.ConfigurationTarget.Workspace);
        }
    });
    context.subscriptions.push(selectLocaleCommand);

    // Initial load
    manager.reloadProperties();
    updateStatusBar();

    // Watch for properties file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.properties');
    watcher.onDidChange(() => manager.reloadProperties());
    watcher.onDidCreate(() => manager.reloadProperties());
    watcher.onDidDelete(() => manager.reloadProperties());
    context.subscriptions.push(watcher);

    // Also watch for application config changes to reload basenames
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/application.{yml,yaml}');
    configWatcher.onDidChange(() => manager.reloadProperties());
    configWatcher.onDidCreate(() => manager.reloadProperties());
    configWatcher.onDidDelete(() => manager.reloadProperties());
    context.subscriptions.push(configWatcher);

    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('springI18n.viewLocale') || e.affectsConfiguration('springI18n.locales')) {
            updateStatusBar();
            treeProvider.refresh(); // Refresh view if locale changes
            if (vscode.window.activeTextEditor) {
                updateDecorations(vscode.window.activeTextEditor);
            }
        }
    }));

    // Listen to Manager changes to refresh decorations
    manager.onDidChange(() => {
        if (vscode.window.activeTextEditor) {
            updateDecorations(vscode.window.activeTextEditor);
        }
    });

    // Update decorations on activation and editor changes
    if (vscode.window.activeTextEditor) {
        updateDecorations(vscode.window.activeTextEditor);
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            updateDecorations(editor);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            updateDecorations(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);

    // Hover provider
    vscode.languages.registerHoverProvider('java', {
        provideHover(document, position, token) {
            const text = document.getText();
            const pattern = getPattern();

            pattern.lastIndex = 0; // Reset
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const start = document.positionAt(match.index);
                const end = document.positionAt(match.index + match[0].length);
                const keyRange = new vscode.Range(start, end);

                if (keyRange.contains(position)) {
                    const key = match[1]; // Capture group 1 is the key
                    const hoverText = new vscode.MarkdownString();
                    hoverText.appendMarkdown(`**i18n Key:** \`${key}\`\n\n`);

                    // Show all locales
                    // We need to iterate over available locales in manager.
                    // Or iterate over configured locales?
                    // Let's iterate over ALL locales found in cache.
                    const manager = I18nManager.getInstance();
                    for (const locale in manager.propertiesCache) {
                         const value = manager.getTranslation(key, locale);
                         if (value) {
                             // Can we get URI?
                             const uri = manager.getSourceFile(key, locale);
                             let localeStr = `**[${locale}]`;
                             if (uri) {
                                 const args = [uri];
                                 const commandUri = vscode.Uri.parse(
                                     `command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`
                                 );
                                 localeStr += `(${commandUri})`;
                             }
                             localeStr += `:** ${value}\n\n`;
                             hoverText.appendMarkdown(localeStr);
                         }
                    }

                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText);
                }
            }
            return undefined;
        }
    });
}

function updateStatusBar() {
    const config = vscode.workspace.getConfiguration('springI18n');
    const viewLocale = config.get<string>('viewLocale');

    if (viewLocale) {
        statusBarItem.text = `$(globe) ${viewLocale}`;
        statusBarItem.tooltip = `Showing translations for ${viewLocale}`;
    } else {
        statusBarItem.text = `$(globe) Auto`;
        statusBarItem.tooltip = `Showing translations based on priority list`;
    }
    statusBarItem.command = 'springI18n.selectLocale';
    statusBarItem.show();
}


function getPattern(): RegExp {
    const config = vscode.workspace.getConfiguration('springI18n');
    let rawRegex = config.get<string>('keyRegex') || '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
    try {
        return new RegExp(rawRegex, 'g');
    } catch (e) {
        console.error(`Invalid regex pattern: ${rawRegex}`, e);
        return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
    }
}

function updateDecorations(editor: vscode.TextEditor) {
    if (editor.document.languageId !== 'java') {
        return;
    }

    const config = vscode.workspace.getConfiguration('springI18n');
    const priorityLocales = config.get<string[]>('locales') || ['ko', 'en'];
    const viewLocale = config.get<string>('viewLocale');

    // Use viewLocale if set, otherwise use priorityLocales
    let effectiveLocales = priorityLocales;
    if (viewLocale) {
        effectiveLocales = [viewLocale];
    }

    const manager = I18nManager.getInstance();
    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];
    const pattern = getPattern();

    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
        // The key is capture group 1. If no group 1, use group 0.
        const key = match[1] || match[0];

        const startPos = editor.document.positionAt(match.index + match[0].length);
        const endPos = editor.document.positionAt(match.index + match[0].length);

        // Find translation based on priority
        let translation = null;
        for (const locale of effectiveLocales) {
            const val = manager.getTranslation(key, locale);
            if (val) {
                translation = val;
                break;
            }
        }

        if (!translation && !viewLocale) {
             // Try 'default' first
             translation = manager.getTranslation(key, 'default') || null;

             if (!translation) {
                 // Try first available
                 const firstLocale = Object.keys(manager.propertiesCache)[0];
                 if (firstLocale) translation = manager.getTranslation(key, firstLocale) || null;
             }
        }

        if (translation) {
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: {
                        contentText: `  📝 ${translation}`,
                    },
                },
            };
            decorations.push(decoration);
        }
    }

    editor.setDecorations(DECORATION_TYPE, decorations);
}

export function deactivate() {}
