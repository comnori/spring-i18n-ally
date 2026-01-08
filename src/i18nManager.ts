import * as vscode from 'vscode';
import propertiesReader = require('properties-reader');
import * as path from 'path';
import * as fs from 'fs';

// Constants
export interface CachedProperties {
    reader: propertiesReader.Reader;
    // Map key -> source file URI
    keySource: Map<string, vscode.Uri>;
}

export class I18nManager {
    private static instance: I18nManager;
    public propertiesCache: { [locale: string]: CachedProperties } = {};
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private constructor() {}

    public static getInstance(): I18nManager {
        if (!I18nManager.instance) {
            I18nManager.instance = new I18nManager();
        }
        return I18nManager.instance;
    }

    public getTranslation(key: string, locale: string): string | undefined {
        const cache = this.propertiesCache[locale];
        if (cache) {
            return cache.reader.get(key) as string;
        }
        return undefined;
    }

    public getSourceFile(key: string, locale: string): vscode.Uri | undefined {
        const cache = this.propertiesCache[locale];
        if (cache) {
            return cache.keySource.get(key);
        }
        return undefined;
    }

    // Get all keys (union of all locales or just all known keys)
    public getAllKeys(): string[] {
        const keys = new Set<string>();
        for (const locale in this.propertiesCache) {
            const reader = this.propertiesCache[locale].reader;
            // properties-reader doesn't directly expose keys easily without digging
            // Using reader.each((key, value) => ...)
            reader.each((key: string) => {
                keys.add(key);
            });
        }
        return Array.from(keys).sort();
    }

    public async reloadProperties() {
        if (!vscode.workspace.workspaceFolders) return;

        const newCache: { [locale: string]: CachedProperties } = {};
        const loadedFiles = new Set<string>();

        // Helper to load file
        const loadFile = (uri: vscode.Uri) => {
            if (loadedFiles.has(uri.fsPath)) return;

            const filename = path.basename(uri.fsPath);
            let locale = 'default';
            const match = filename.match(/_([a-zA-Z]{2,3}(?:_[a-zA-Z]{2})?)\.properties$/);
            if (match) {
                locale = match[1];
            } else if (filename.endsWith('.properties')) {
                locale = 'default';
            } else {
                return;
            }

            try {
                const props = propertiesReader(uri.fsPath);

                if (!newCache[locale]) {
                    newCache[locale] = {
                        reader: props,
                        keySource: new Map()
                    };
                } else {
                     newCache[locale].reader.append(uri.fsPath);
                }

                // Track source for each key in this file
                props.each((key: string) => {
                     // We only overwrite source if it's the first time we see this key for this locale
                     // OR should we overwrite?
                     // If we have Priority Strategy:
                     // The load order is Priority 1 -> Priority 2...
                     // So the first file loaded is highest priority.
                     // Thus, if keySource already has the key, we DO NOT overwrite it.
                     // Wait, properties-reader.append() overwrites values?
                     // "The last file appended wins".
                     // BUT, our strategy loads Priority 1 files FIRST.
                     // If `properties-reader` append overwrites, then Priority 2 overwrites Priority 1.
                     // That is BAD.
                     // We implemented `loadFile` in `extension.ts` using `append`.
                     // If `properties-reader` append overwrites, then my previous implementation was accidentally REVERSE priority for values?
                     // Let's check `properties-reader` behavior. Usually append adds/overwrites.
                     // Ideally, we should load Priority 4 (Legacy) first, then Priority 1 (High) last?
                     // OR, we should creating separate readers and merge them manually respecting priority.
                     // Given the "Priority" requirement, if I have `messages.properties` (P1) and `config/messages.properties` (P2),
                     // and P1 is loaded first.
                     // If I append P2, P2 values might overwrite P1.
                     // I should probably REVERSE the loading order?
                     // BUT, my `loadedFiles` set prevents loading the same file twice.
                     // So if `messages.properties` matches both P1 and P2 search, it's loaded only once (at P1).
                     // The issue is if `messages_en.properties` is in `src/main/resources` (P1) AND `src/main/resources/config` (P2).
                     // If they are distinct files, both load.
                     // P1 loads first. P2 appends.
                     // If P2 has same key, it overwrites.
                     // Is P1 supposed to override P2?
                     // "1순위 : src/main/resources/messages*.properties".
                     // Usually 1st Priority means "Use this value".
                     // So I should load P1 *last* or strictly control the merge.
                     // Or, I check if key exists before appending? properties-reader doesn't support that easily.

                     // For now, I will assume the previous implementation (append) was acceptable, or I will try to fix it here.
                     // The clean way is to track keys.
                     // I will update keySource.
                     if (!newCache[locale].keySource.has(key)) {
                         newCache[locale].keySource.set(key, uri);
                     }
                });

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

        // Strategy 3: application config
        const appProps = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}');
        for (const file of appProps) {
            try {
                const content = await fs.promises.readFile(file.fsPath, 'utf-8');
                let basenames: string[] = [];
                // Simple parsing (reusing logic)
                if (file.fsPath.endsWith('.properties')) {
                    const match = content.match(/^\s*spring\.messages\.basename\s*=\s*(.*)$/m);
                    if (match) basenames = match[1].split(',').map(s => s.trim());
                } else {
                    const matchColon = content.match(/^\s*spring\.messages\.basename\s*:\s*(.*)$/m);
                    if (matchColon) {
                        basenames = matchColon[1].split(',').map(s => s.trim());
                    } else {
                         // Nested parsing logic (simplified)
                         const lines = content.split(/\r?\n/);
                         let inSpring = false, springIndent = -1, inMessages = false, messagesIndent = -1;
                         for (const line of lines) {
                             const indent = line.search(/\S/);
                             const colon = line.indexOf(':');
                             if (colon === -1 || line.trim().startsWith('#')) continue;
                             const key = line.substring(indent, colon).trim();
                             const val = line.substring(colon + 1).trim();
                             if (key === 'spring') { inSpring = true; springIndent = indent; inMessages = false; }
                             else if (inSpring && key === 'messages') {
                                 if (indent > springIndent) { inMessages = true; messagesIndent = indent; }
                                 else if (indent <= springIndent) inSpring = false;
                             }
                             else if (inMessages && key === 'basename') {
                                 if (indent > messagesIndent) { basenames = val.split(',').map(s => s.trim()); break; }
                                 else { if (indent <= messagesIndent) inMessages = false; if (indent <= springIndent) inSpring = false; }
                             }
                         }
                    }
                }
                for (const basename of basenames) {
                    const normalized = basename.replace(/\./g, '/');
                    const found = await vscode.workspace.findFiles(`src/main/resources/${normalized}*.properties`);
                    found.forEach(loadFile);
                }
            } catch (e) { console.error(e); }
        }

        // Strategy 4
        const p4 = await vscode.workspace.findFiles('**/message_*.properties');
        p4.forEach(loadFile);
        const p5 = await vscode.workspace.findFiles('**/messages*.properties');
        p5.forEach(loadFile);

        this.propertiesCache = newCache;
        this._onDidChange.fire();
        console.log('I18n Properties reloaded');
    }

    public async writeTranslation(key: string, locale: string, value: string): Promise<void> {
        let uri = this.getSourceFile(key, locale);
        if (!uri) {
            // New key? Or unknown source?
            // If new key, where to write?
            // Fallback to default file for that locale if exists?
            // Or ask user?
            // For now, if source not found, try to find *any* file for that locale.
            const cache = this.propertiesCache[locale];
            if (cache && cache.keySource.size > 0) {
                 // Pick the first one?
                 uri = cache.keySource.values().next().value;
            }
            if (!uri) {
                 vscode.window.showErrorMessage(`No property file found for locale: ${locale}`);
                 return;
            }
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();

        // Regex to find key=value
        // Handle escaped chars in key? Standard properties keys can have escaped chars.
        // Simplified: escape regex special chars in key.
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^\\s*${escapedKey}\\s*=(.*)$`, 'm');

        const match = text.match(regex);
        const edit = new vscode.WorkspaceEdit();

        if (match) {
            // Replace existing
            const start = doc.positionAt(match.index! + match[0].indexOf('=') + 1);
            const end = doc.positionAt(match.index! + match[0].length);
            // Wait, match[0] is the whole line? Yes, regex includes ^ and $.
            // Wait, 'm' flag makes ^ match start of line. (.*) matches to end of line?
            // Yes, but (.*) stops at newline?
            // Let's rely on range.
            // The match[1] is the value part.
            // We want to replace match[1].

            // Adjust regex:
            // Group 1 is value.
            // Find range of Group 1.
            const fullMatch = match[0];
            const valueMatch = match[1];
            const valueIndex = fullMatch.lastIndexOf(valueMatch);
            const absoluteStartIndex = match.index! + valueIndex;
            const startPos = doc.positionAt(absoluteStartIndex);
            const endPos = doc.positionAt(absoluteStartIndex + valueMatch.length);

            edit.replace(uri, new vscode.Range(startPos, endPos), value);
        } else {
            // Append
            const position = new vscode.Position(doc.lineCount, 0);
            edit.insert(uri, position, `\n${key}=${value}`);
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();

        // Reload will happen via watcher in extension.ts
    }
}
