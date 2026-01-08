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
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.properties');
    watcher.onDidChange(() => reloadProperties());
    watcher.onDidCreate(() => reloadProperties());
    watcher.onDidDelete(() => reloadProperties());
    context.subscriptions.push(watcher);

    // Also watch for application config changes to reload basenames
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/application.{yml,yaml}');
    configWatcher.onDidChange(() => reloadProperties());
    configWatcher.onDidCreate(() => reloadProperties());
    configWatcher.onDidDelete(() => reloadProperties());
    context.subscriptions.push(configWatcher);

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
    let rawRegex = config.get<string>('keyRegex') || '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
    try {
        return new RegExp(rawRegex, 'g');
    } catch (e) {
        console.error(`Invalid regex pattern: ${rawRegex}`, e);
        return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
    }
}

async function reloadProperties() {
    if (!vscode.workspace.workspaceFolders) return;

    // Clear cache to start fresh
    const newCache: { [locale: string]: CachedProperties } = {};
    const loadedFiles = new Set<string>();

    // Helper to load file
    const loadFile = (uri: vscode.Uri) => {
        if (loadedFiles.has(uri.fsPath)) return;

        const filename = path.basename(uri.fsPath);
        // Match standard message_*.properties or just *.properties if we can infer locale
        // Regex: (basename)(_locale)?.properties
        // But we need to handle "messages.properties" (default) vs "messages_en.properties"

        let locale = 'default';
        // Try to find locale code (2-3 chars, optional region)
        // e.g. messages_en.properties, messages_en_US.properties, message_ko.properties
        const match = filename.match(/_([a-zA-Z]{2,3}(?:_[a-zA-Z]{2})?)\.properties$/);
        if (match) {
            locale = match[1];
        } else if (filename.endsWith('.properties')) {
            // Check if it is the base file (no underscore locale before extension)
            // e.g. messages.properties
            locale = 'default';
        } else {
            return; // Not a properties file we recognize
        }

        try {
            const props = propertiesReader(uri.fsPath);
            // If we already have this locale, we append to it (Merge)
            // But we can only merge if we have a way to merge readers.
            // properties-reader adds values to the object.

            if (!newCache[locale]) {
                newCache[locale] = {
                    reader: props,
                    uri: uri
                };
                console.log(`Loaded properties for ${locale} from ${uri.fsPath}`);
            } else {
                 // Append
                 // properties-reader documentation says: .append(filePath)
                 // But we have a Reader object.
                 // We can use newCache[locale].reader.append(uri.fsPath);
                 newCache[locale].reader.append(uri.fsPath);
                 console.log(`Merged ${uri.fsPath} into ${locale}`);
            }
            loadedFiles.add(uri.fsPath);
        } catch (e) {
            console.error(`Failed to load ${uri.fsPath}`, e);
        }
    };

    // Strategy 1: src/main/resources/messages*.properties
    const p1 = await vscode.workspace.findFiles('src/main/resources/messages*.properties');
    p1.forEach(loadFile);

    // Strategy 2: src/main/resources/**/messages*.properties
    const p2 = await vscode.workspace.findFiles('src/main/resources/**/messages*.properties');
    p2.forEach(loadFile);

    // Strategy 3: application.properties / application.yml -> spring.messages.basename
    const appProps = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}');

    for (const file of appProps) {
        try {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            let basenames: string[] = [];

            // Simple parsing for spring.messages.basename
            if (file.fsPath.endsWith('.properties')) {
                const match = content.match(/^spring\.messages\.basename\s*=\s*(.*)$/m);
                if (match) {
                    basenames = match[1].split(',').map(s => s.trim());
                }
            } else { // YAML
                // Check flattened first
                const matchColon = content.match(/^\s*spring\.messages\.basename\s*:\s*(.*)$/m);
                if (matchColon) {
                    basenames = matchColon[1].split(',').map(s => s.trim());
                } else {
                    // Manual Nested Parsing
                    // 1. Find "spring:" at root indentation
                    // 2. Find "messages:" inside spring
                    // 3. Find "basename:" inside messages

                    const lines = content.split(/\r?\n/);
                    let inSpring = false;
                    let springIndent = -1;
                    let inMessages = false;
                    let messagesIndent = -1;

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine.startsWith('#')) continue;

                        const indent = line.search(/\S/);
                        const colonIndex = line.indexOf(':');
                        if (colonIndex === -1) continue;

                        const key = line.substring(indent, colonIndex).trim();
                        const value = line.substring(colonIndex + 1).trim();

                        if (key === 'spring') {
                            inSpring = true;
                            springIndent = indent;
                            inMessages = false;
                        } else if (inSpring && key === 'messages') {
                             if (indent > springIndent) {
                                 inMessages = true;
                                 messagesIndent = indent;
                             } else {
                                 // Exited spring block?
                                 if (indent <= springIndent) inSpring = false;
                             }
                        } else if (inMessages && key === 'basename') {
                            if (indent > messagesIndent) {
                                basenames = value.split(',').map(s => s.trim());
                                break; // Found it
                            } else {
                                if (indent <= messagesIndent) inMessages = false;
                                if (indent <= springIndent) inSpring = false;
                            }
                        }
                    }
                }
            }

            for (const basename of basenames) {
                // basename can be "messages" or "i18n/messages"
                // It is relative to classpath (src/main/resources)
                const normalizedBasename = basename.replace(/\./g, '/');

                // Pattern: src/main/resources/normalizedBasename*.properties
                const pattern = `src/main/resources/${normalizedBasename}*.properties`;
                const found = await vscode.workspace.findFiles(pattern);
                found.forEach(loadFile);
            }
        } catch (e) {
            console.error(`Error parsing config file ${file.fsPath}`, e);
        }
    }

    // Strategy 4: Existing logic (**/message_*.properties)
    const p4 = await vscode.workspace.findFiles('**/message_*.properties');
    p4.forEach(loadFile);

    // Also include default "messages.properties" if missed by p4 (p4 checks message_*)
    const p5 = await vscode.workspace.findFiles('**/messages*.properties');
    p5.forEach(loadFile);

    propertiesCache = newCache;

    // Refresh decorations
    if (vscode.window.activeTextEditor) {
        updateDecorations(vscode.window.activeTextEditor);
    }
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
             // Try 'default' first
             if (propertiesCache['default']) {
                 translation = propertiesCache['default'].reader.get(key);
             }

             if (!translation) {
                 const firstLocale = Object.keys(propertiesCache)[0];
                 if (firstLocale) translation = propertiesCache[firstLocale].reader.get(key);
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
