import * as vscode from 'vscode';
import { I18nManager } from './i18nManager';
import { I18nKeyTreeProvider, I18nItem } from './views/I18nKeyTreeProvider';
import { editI18nKey } from './commands/editKey';
import { extractI18nKey } from './commands/extractKey';
import { TranslationWebview } from './views/TranslationWebview';
import { debounce } from './utils/debounce';
import { Logger } from './utils/Logger';
import { EditorDecorator } from './services/EditorDecorator';
import { I18nHoverProvider } from './services/I18nHoverProvider';

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    Logger.info('Spring i18n Helper is starting...');
    Logger.show();

    // Initialize Manager
    const manager = I18nManager.getInstance();
    await manager.init();

    // Initialize Services
    const decorator = EditorDecorator.getInstance();

    // Register View Provider
    const treeProvider = new I18nKeyTreeProvider();
    vscode.window.createTreeView('springI18nView', { treeDataProvider: treeProvider });

    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.editKey', editI18nKey));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.extractKey', extractI18nKey));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.openTranslationEditor', (item: I18nItem | string) => {
        const key = item instanceof I18nItem ? item.keyPath : item;
        TranslationWebview.createOrShow(context.extensionUri, key);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.refresh', () => {
        manager.reloadProperties();
        treeProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.addKey', async () => {
        const key = await vscode.window.showInputBox({
            placeHolder: 'Enter new i18n key',
            prompt: 'Key name (e.g. user.login.title)'
        });
        if (key) {
            TranslationWebview.createOrShow(context.extensionUri, key);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.expandAll', () => {
        treeProvider.setCollapsibleState(vscode.TreeItemCollapsibleState.Expanded);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.collapseAll', () => {
        treeProvider.setCollapsibleState(vscode.TreeItemCollapsibleState.Collapsed);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.search', async () => {
        const filter = await vscode.window.showInputBox({
            placeHolder: 'Search keys...',
            prompt: 'Enter search term (empty to clear)'
        });
        treeProvider.setFilter(filter || '');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.deleteKey', async (item: I18nItem) => {
        if (!item || !item.keyPath) return;
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete key '${item.keyPath}'?`,
            { modal: true },
            'Delete'
        );
        if (confirm === 'Delete') {
            await manager.deleteKey(item.keyPath);
            treeProvider.refresh();
        }
    }));

    // Initialize Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Register Command to Select Locale
    context.subscriptions.push(vscode.commands.registerCommand('springI18n.selectLocale', async () => {
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
    }));

    // Update status bar initially
    updateStatusBar();

    // Watch for properties file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{properties,yml,yaml}');
    watcher.onDidChange(() => manager.reloadProperties());
    watcher.onDidCreate(() => manager.reloadProperties());
    watcher.onDidDelete(() => manager.reloadProperties());
    context.subscriptions.push(watcher);

    // Also watch for application config changes to reload basenames
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/application.{properties,yml,yaml}');
    configWatcher.onDidChange(() => manager.reloadProperties());
    configWatcher.onDidCreate(() => manager.reloadProperties());
    configWatcher.onDidDelete(() => manager.reloadProperties());
    context.subscriptions.push(configWatcher);

    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('springI18n.viewLocale') || e.affectsConfiguration('springI18n.locales')) {
            updateStatusBar();
            treeProvider.refresh();
            if (vscode.window.activeTextEditor) {
                decorator.updateDecorations(vscode.window.activeTextEditor);
            }
            if (TranslationWebview.currentPanel) {
                TranslationWebview.currentPanel.update();
            }
        }
    }));

    // Listen to Manager changes to refresh decorations
    manager.onDidChange(() => {
        if (vscode.window.activeTextEditor) {
            decorator.updateDecorations(vscode.window.activeTextEditor);
            treeProvider.refresh();
        }
    });

    // Editor Event Listeners for Decorations
    if (vscode.window.activeTextEditor) {
        decorator.updateDecorations(vscode.window.activeTextEditor);
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            decorator.updateDecorations(editor);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            decorator.updateDecorations(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);

    const debouncedUpdate = debounce((editor: vscode.TextEditor) => decorator.updateDecorations(editor), 100);
    vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor) {
            debouncedUpdate(event.textEditor);
        }
    }, null, context.subscriptions);

    // Register Hover Provider
    context.subscriptions.push(vscode.languages.registerHoverProvider('java', new I18nHoverProvider()));

    Logger.info('Spring i18n Helper is now active!');
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

export function deactivate() {
    EditorDecorator.getInstance().dispose();
}
