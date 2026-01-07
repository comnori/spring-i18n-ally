import * as vscode from 'vscode';
import propertiesReader = require('properties-reader');
import * as path from 'path';
import * as fs from 'fs';

// Constants
const DECORATION_TYPE = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 1em',
        color: 'gray',
        fontStyle: 'italic'
    }
});

// Cache for properties
interface CachedProperties {
    reader: propertiesReader.Reader;
    uri: vscode.Uri;
}
let propertiesCache: { [locale: string]: CachedProperties } = {};

export function activate(context: vscode.ExtensionContext) {
    console.log('Java Spring i18n Helper is now active!');

    // Initial load
    reloadProperties();

    // Watch for properties file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/message_*.properties');
    watcher.onDidChange(() => reloadProperties());
    watcher.onDidCreate(() => reloadProperties());
    watcher.onDidDelete(() => reloadProperties());
    context.subscriptions.push(watcher);

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
            const patterns = getPatterns();

            for (const pattern of patterns) {
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
                        for (const locale in propertiesCache) {
                            const entry = propertiesCache[locale];
                            const value = entry.reader.get(key);
                            if (value) {
                                // Add link to definition
                                // Since properties-reader doesn't give line numbers, we just link to the file.
                                // It would be better if we could jump to the line, but we'd need to re-read file text or write a custom parser.
                                // For MVP, link to file is "Go to Definition" equivalent given constraints.
                                const args = [entry.uri];
                                const commandUri = vscode.Uri.parse(
                                    `command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`
                                );

                                hoverText.appendMarkdown(`**[${locale}](${commandUri}):** ${value}\n\n`);
                            }
                        }

                        hoverText.isTrusted = true;
                        return new vscode.Hover(hoverText);
                    }
                }
            }
            return undefined;
        }
    });
}

function getPatterns(): RegExp[] {
    const config = vscode.workspace.getConfiguration('javaI18n');
    const userPatterns: string[] = config.get('detectionPatterns') || [];

    // Default pattern: "key.subkey"
    // Regex: /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g
    const defaultPattern = /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;

    const patterns = [defaultPattern];

    for (const p of userPatterns) {
        try {
            // User patterns should be strings that we convert to RegExp
            // We ensure 'g' flag is present
            patterns.push(new RegExp(p, 'g'));
        } catch (e) {
            console.error(`Invalid regex pattern: ${p}`, e);
        }
    }

    return patterns;
}

function reloadProperties() {
    if (!vscode.workspace.workspaceFolders) return;

    // Find all message_*.properties files
    vscode.workspace.findFiles('**/message_*.properties').then(files => {
        propertiesCache = {};
        files.forEach(file => {
            const filename = path.basename(file.fsPath);
            // Extract locale: message_en.properties -> en
            const match = filename.match(/message_([a-zA-Z_]+)\.properties/);
            if (match) {
                const locale = match[1];
                try {
                    // properties-reader handles unicode escapes automatically
                    const props = propertiesReader(file.fsPath);
                    propertiesCache[locale] = {
                        reader: props,
                        uri: file
                    };
                    console.log(`Loaded properties for ${locale}`);
                } catch (e) {
                    console.error(`Failed to load ${file.fsPath}`, e);
                }
            }
        });

        // Refresh decorations
        if (vscode.window.activeTextEditor) {
            updateDecorations(vscode.window.activeTextEditor);
        }
    });
}

function updateDecorations(editor: vscode.TextEditor) {
    if (editor.document.languageId !== 'java') {
        return;
    }

    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];
    const patterns = getPatterns();

    for (const pattern of patterns) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
            const key = match[1];
            const startPos = editor.document.positionAt(match.index + match[0].length);
            const endPos = editor.document.positionAt(match.index + match[0].length);

            // Default to 'ko' then 'en' then first available
            let translation = null;
            if (propertiesCache['ko']) translation = propertiesCache['ko'].reader.get(key);
            else if (propertiesCache['en']) translation = propertiesCache['en'].reader.get(key);
            else {
                const firstLocale = Object.keys(propertiesCache)[0];
                if (firstLocale) translation = propertiesCache[firstLocale].reader.get(key);
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
    }

    editor.setDecorations(DECORATION_TYPE, decorations);
}

export function deactivate() {}
