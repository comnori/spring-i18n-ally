# Future Steps: Side Panel & Write-back Interfaces

## 1. Side Panel (Tree View)

To implement the sidebar view grouping keys hierarchically (e.g., `message` > `error` > `login`), we need to implement the `vscode.TreeDataProvider` interface.

### Interfaces & Classes

```typescript
export class I18nKeyTreeProvider implements vscode.TreeDataProvider<I18nItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<I18nItem | undefined | void> = new vscode.EventEmitter<I18nItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<I18nItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string) {
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: I18nItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: I18nItem): Thenable<I18nItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No dependency in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            // Return children of the key node
            return Promise.resolve(this.getChildrenKeys(element));
        } else {
            // Return root keys or grouped top-level keys
            return Promise.resolve(this.getTopLevelKeys());
        }
    }

    // ... helper methods to structure keys hierarchically
}

export class I18nItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly keyPath: string,
        public readonly value: string
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}: ${this.value}`;
        this.description = this.value;
    }
}
```

## 2. Direct Editing (Write-back)

To allow modifying the translation text via a command or CodeLens and write back to the `.properties` file.

### Interfaces & Functions

```typescript
/**
 * Command to edit a specific key.
 * Can be triggered from CodeLens or Tree View context menu.
 */
export async function editI18nKey(key: string, locale: string) {
    const value = await vscode.window.showInputBox({
        prompt: `Edit translation for ${key} (${locale})`,
        value: getCurrentValue(key, locale)
    });

    if (value !== undefined) {
        await writeToPropertiesFile(key, locale, value);
    }
}

/**
 * Writes the new value to the properties file, preserving structure and encoding.
 */
async function writeToPropertiesFile(key: string, locale: string, newValue: string): Promise<void> {
    const filename = `message_${locale}.properties`;
    // Locate the file in workspace
    const files = await vscode.workspace.findFiles(`**/${filename}`);
    if (files.length === 0) return;

    const uri = files[0];
    const doc = await vscode.workspace.openTextDocument(uri);

    // We need to parse the file line by line or use a library that supports writing without destroying comments/formatting.
    // 'properties-reader' is read-only for the most part or doesn't guarantee preserving comments on write.
    // Better to read file text, regex replace the key=value line, and write back.

    const text = doc.getText();
    const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*=(.*)$`, 'm');

    // Check if key exists
    // If exists, replace line
    // If not, append to end

    // Use WorkspaceEdit for undo support
    const edit = new vscode.WorkspaceEdit();
    // ... calculate edit ...
    await vscode.workspace.applyEdit(edit);

    // Save document
    await doc.save();
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```
