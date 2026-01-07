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
    console.log('Spring i18n Helper is now active!');

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
                    for (const locale in propertiesCache) {
                        const entry = propertiesCache[locale];
                        const value = entry.reader.get(key);
                        if (value) {
                            // Add link to definition
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
            return undefined;
        }
    });
}

function getPattern(): RegExp {
    const config = vscode.workspace.getConfiguration('springI18n');
    // Default: "([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"
    // The user pattern is expected to capture the key in group 1.
    // However, the provided default in package.json is just the key part: ([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)
    // In Java, these are usually quoted.
    // The previous implementation wrapped it in quotes: /"..."/g
    // The new requirement implies "Custom Regex to identify i18n keys".
    // If the user provides just the key regex, we might need to assume context or if the regex *is* the whole match.
    // Given the default value `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)`, it matches "user.login".
    // But in source code it appears as "user.login".
    // I should check if I need to wrap it in quotes.
    // If the user changes it to detect constants like KEY_LOGIN, quotes might not be present.
    // However, for the default case, it is safer to assume the regex provided *is* the regex to use.
    // But wait, the default provided `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)` will match `user.login` even without quotes in the regex itself, but it might match imports or comments too easily.
    // Previous default was /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g
    // The new default is `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)`

    // Let's read the raw string from config.
    let rawRegex = config.get<string>('keyRegex') || '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';

    // If the user pattern doesn't look like it handles quotes, and we are in Java, maybe we should assume quotes?
    // But "Custom Regex" usually implies full control.
    // Let's assume the user provides the *Key Matching Regex* and we expect it to be in the code.
    // Actually, looking at the previous default `/"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g`, the outer quotes were part of the regex.
    // The new default `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)` does NOT have quotes.
    // If I use this strictly, it will match `package com.example.demo;` -> key `com.example.demo`. This is bad.
    // However, I must respect the provided `package.json`.
    // Maybe the user *intended* to wrap it in quotes in the string?
    // "default": "([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)"
    // If I construct `new RegExp(rawRegex, 'g')`, it will match everywhere.
    // To preserve the behavior of "Java Properties", it's highly likely it should be quoted.
    // BUT, the prompt says "Custom Regex to identify i18n keys".
    // I'll stick to what is provided. If it matches too much, that's the default config's fault.
    // WAIT, I can improve this by checking if it's the default and wrapping it, OR just expecting the user to provide quotes if they want them.
    // But for a good DX, let's wrap the default in quotes logic if it looks like the default?
    // No, that's magic.

    // Let's look at the previous logic.
    // `detectionPatterns` was an array of strings.
    // Now it is `keyRegex` string.

    // Use the regex as is. Note: The `package.json` default does NOT have quotes.
    // I will append quotes to the regex construction ONLY IF I want to enforce it.
    // But I shouldn't.
    // However, I will wrap it in `"` for the specific case of the *default* if I want to match the previous behavior, but the user explicitly gave a new default.
    // Actually, let's look at the new default again: `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)`
    // It captures the whole thing.

    // Let's just use it.
    try {
        return new RegExp(rawRegex, 'g');
    } catch (e) {
        console.error(`Invalid regex pattern: ${rawRegex}`, e);
        // Fallback to a safe quoted default
        return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
    }
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

    const config = vscode.workspace.getConfiguration('springI18n');
    const priorityLocales = config.get<string[]>('locales') || ['ko', 'en'];

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
        for (const locale of priorityLocales) {
            if (propertiesCache[locale]) {
                const val = propertiesCache[locale].reader.get(key);
                if (val) {
                    translation = val;
                    break;
                }
            }
        }

        // Fallback to any available if not found in priority
        if (!translation) {
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

    editor.setDecorations(DECORATION_TYPE, decorations);
}

export function deactivate() {}
