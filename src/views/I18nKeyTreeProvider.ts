import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';

export class I18nItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly keyPath: string,
        public readonly value: string = ''
    ) {
        super(label, collapsibleState);
        if (value) {
            this.description = value;
            this.tooltip = `${keyPath}: ${value}`;
        } else {
            this.tooltip = keyPath;
        }

        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.contextValue = 'i18nItem';
            this.command = {
                command: 'springI18n.openTranslationEditor',
                title: 'Open Translation Editor',
                arguments: [this]
            };
        } else {
            this.contextValue = 'i18nGroup';
        }
    }
}

export class I18nKeyTreeProvider implements vscode.TreeDataProvider<I18nItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<I18nItem | undefined | void> = new vscode.EventEmitter<I18nItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<I18nItem | undefined | void> = this._onDidChangeTreeData.event;

    private _filter: string = '';
    private _defaultCollapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

    constructor() {
        I18nManager.getInstance().onDidChange(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setFilter(filter: string) {
        this._filter = filter;
        this.refresh();
    }

    setCollapsibleState(state: vscode.TreeItemCollapsibleState) {
        this._defaultCollapsibleState = state;
        this.refresh();
    }

    getTreeItem(element: I18nItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: I18nItem): Thenable<I18nItem[]> {
        if (!vscode.workspace.workspaceFolders) {
            return Promise.resolve([]);
        }

        const manager = I18nManager.getInstance();
        let allKeys = manager.getAllKeys(); // sorted array of keys

        // Filter keys if filter is set
        if (this._filter) {
            const lowerFilter = this._filter.toLowerCase();
            allKeys = allKeys.filter(k => k.toLowerCase().includes(lowerFilter));
        }

        if (element) {
            // Children of a specific group
            // If element is "user", we look for "user.login", "user.name", etc.
            // But grouped logic is tricky if keys are just strings.
            // We need to parse keys into tree structure on the fly or pre-process.
            // Let's do simple prefix matching.
            const parentKey = element.keyPath;
            return Promise.resolve(this.getDirectChildren(allKeys, parentKey));
        } else {
            // Roots
            return Promise.resolve(this.getDirectChildren(allKeys, ''));
        }
    }

    private getDirectChildren(allKeys: string[], parentKey: string): I18nItem[] {
        const children = new Map<string, I18nItem>();

        // Configured view locale
        const config = vscode.workspace.getConfiguration('springI18n');
        const viewLocale = config.get<string>('viewLocale') || config.get<string[]>('locales')?.[0] || 'en';

        for (const key of allKeys) {
            if (parentKey && !key.startsWith(parentKey + '.')) continue;

            const relativeKey = parentKey ? key.substring(parentKey.length + 1) : key;
            const parts = relativeKey.split('.');
            const segment = parts[0];

            if (children.has(segment)) continue;

            const isLeaf = parts.length === 1;
            const fullPath = parentKey ? `${parentKey}.${segment}` : segment;

            let value = '';
            if (isLeaf) {
                // Get value for viewLocale
                value = I18nManager.getInstance().getTranslation(fullPath, viewLocale) || '';
            }

            const item = new I18nItem(
                segment,
                isLeaf ? vscode.TreeItemCollapsibleState.None : this._defaultCollapsibleState,
                fullPath,
                value
            );
            children.set(segment, item);
        }

        return Array.from(children.values());
    }
}
