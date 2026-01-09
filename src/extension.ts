import * as vscode from 'vscode';
import { I18nManager } from './i18nManager';
import { I18nKeyTreeProvider, I18nItem } from './views/I18nKeyTreeProvider';
import { editI18nKey } from './commands/editKey';
import { extractI18nKey } from './commands/extractKey';
import { TranslationWebview } from './views/TranslationWebview';
import { debounce } from './utils/debounce';

// Constants
const DECORATION_TYPE = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none; display: inline-block; width: 0;', // Hide original text hack? No.
    // To hide text, we can use color: transparent.
    color: 'transparent',
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
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.openTranslationEditor', (item: I18nItem | string) => {
        const key = item instanceof I18nItem ? item.keyPath : item;
        TranslationWebview.createOrShow(context.extensionUri, key);
    }));

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

    // Toggle decorations on selection change to reveal/hide key
    const debouncedUpdate = debounce((editor: vscode.TextEditor) => updateDecorations(editor), 100);
    vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor) {
            debouncedUpdate(event.textEditor);
        }
    }, null, context.subscriptions);

    // Hover provider
    vscode.languages.registerHoverProvider('java', {
        provideHover(document, position, token) {
            const lineText = document.lineAt(position.line).text;
            const pattern = getPattern();
            pattern.lastIndex = 0;

            let match;
            while ((match = pattern.exec(lineText)) !== null) {
                const key = match[1] || match[0];
                const startChar = match.index;
                const endChar = match.index + match[0].length;

                // Adjust range to be relative to the line
                const range = new vscode.Range(position.line, startChar, position.line, endChar);

                if (range.contains(position)) {
                    const hoverText = new vscode.MarkdownString();
                    hoverText.appendMarkdown(`**i18n Key:** \`${key}\`\n\n`);

                    const manager = I18nManager.getInstance();
                    for (const locale in manager.propertiesCache) {
                         const value = manager.getTranslation(key, locale);
                         if (value) {
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
        const key = match[1] || match[0];
        // The regex matches the quoted string (usually) or just the key depending on regex.
        // Default regex: "([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"
        // match[0] is "user.name"
        // match[1] is user.name
        // We want to hide the whole match[0].

        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);

        // Check if selection intersects
        // If cursor is on this line (or range), we don't decorate (reveal original)
        // Or if cursor is INSIDE the range.
        let isSelected = false;
        for (const selection of editor.selections) {
            // If selection intersects the range, reveal
            if (selection.intersection(range)) {
                isSelected = true;
                break;
            }
        }

        if (isSelected) {
            continue;
        }

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
            const decoration: vscode.DecorationOptions = {
                range: range,
                renderOptions: {
                    before: {
                        contentText: `📝 ${translation}`,
                        color: 'inherit', // Use default text color for visibility
                        fontStyle: 'italic',
                        margin: '0 8px 0 0'
                    }
                },
                hoverMessage: `Original: ${match[0]}`
            };
            decorations.push(decoration);
        }
    }

    editor.setDecorations(DECORATION_TYPE, decorations);
}

export function deactivate() {}
