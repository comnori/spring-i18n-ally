import * as vscode from 'vscode';
import propertiesReader = require('properties-reader');
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from './utils/Logger';

export interface CachedProperties {
    reader: propertiesReader.Reader;
    keySource: Map<string, vscode.Uri>;
    type: 'properties' | 'yaml';
    yamlObject?: YamlNode;
}

// Define strict types for YAML nodes
interface YamlNode {
    [key: string]: string | number | boolean | YamlNode | undefined;
}

export class I18nManager {
    private static instance: I18nManager;
    public propertiesCache: { [locale: string]: CachedProperties } = {};
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;
    private initPromise: Promise<void> | null = null;

    private constructor() { }

    public static getInstance(): I18nManager {
        if (!I18nManager.instance) {
            I18nManager.instance = new I18nManager();
        }
        return I18nManager.instance;
    }

    public async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.reloadProperties();
        }
        return this.initPromise;
    }

    public getTranslation(key: string, locale: string): string | undefined {
        const cache = this.propertiesCache[locale];
        if (cache) {
            if (cache.type === 'properties') {
                return cache.reader.get(key) as string;
            } else if (cache.type === 'yaml' && cache.yamlObject) {
                return this.getYamlValue(cache.yamlObject, key);
            }
        }
        return undefined;
    }

    private getYamlValue(obj: YamlNode, key: string): string | undefined {
        const parts = key.split('.');
        let current: YamlNode | string | number | boolean | undefined = obj;

        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = (current as YamlNode)[part];
            } else {
                return undefined;
            }
        }
        return typeof current === 'string' || typeof current === 'number' ? String(current) : undefined;
    }

    public getSourceFile(key: string, locale: string): vscode.Uri | undefined {
        const cache = this.propertiesCache[locale];
        if (cache) {
            return cache.keySource.get(key);
        }
        return undefined;
    }

    public getAllKeys(): string[] {
        const keys = new Set<string>();
        for (const locale in this.propertiesCache) {
            const cache = this.propertiesCache[locale];
            if (cache.type === 'properties') {
                cache.reader.each((key: string) => {
                    keys.add(key);
                });
            } else if (cache.type === 'yaml' && cache.yamlObject) {
                this.collectYamlKeys(cache.yamlObject, '', keys);
            }
        }
        return Array.from(keys).sort();
    }

    private collectYamlKeys(obj: YamlNode, prefix: string, keys: Set<string>) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            const val = obj[key];
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof val === 'object' && val !== null) {
                this.collectYamlKeys(val as YamlNode, fullKey, keys);
            } else {
                keys.add(fullKey);
            }
        }
    }

    public async reloadProperties(): Promise<void> {
        if (!vscode.workspace.workspaceFolders) return;

        Logger.info('Reloading properties files...');
        // We will build a new cache and replace the old one to ensure atomicity
        const newCache: { [locale: string]: CachedProperties } = {};
        const loadedFiles = new Set<string>();

        // Helper to process a file found by common logic
        const processFile = async (uri: vscode.Uri) => {
            if (loadedFiles.has(uri.fsPath)) return;

            const filename = path.basename(uri.fsPath);
            let locale = 'default';
            // Regex to find locale: messages_ko.properties, messages_en_US.yml
            const match = filename.match(/_([a-zA-Z]{2,3}(?:_[a-zA-Z]{2})?)\.(properties|yml|yaml)$/);
            if (match) {
                locale = match[1];
            } else if (filename.endsWith('.properties') || filename.endsWith('.yml') || filename.endsWith('.yaml')) {
                locale = 'default';
            } else {
                return;
            }

            try {
                await this.loadSingleFile(uri, locale, newCache);
                loadedFiles.add(uri.fsPath);
                Logger.info(`Loaded: ${uri.fsPath} (${locale})`);
            } catch (e) {
                Logger.error(`Failed to load ${uri.fsPath}`, e);
            }
        };

        const findAndLoad = async (glob: string) => {
            const files = await vscode.workspace.findFiles(glob);
            await Promise.all(files.map(processFile));
        };

        // 1. Standard locations
        await Promise.all([
            findAndLoad('src/main/resources/messages*.{properties,yml,yaml}'),
            findAndLoad('src/main/resources/**/messages*.{properties,yml,yaml}'),
            findAndLoad('**/message_*.{properties,yml,yaml}'), // Common variation
            findAndLoad('**/messages*.{properties,yml,yaml}') // Capture all messages* files
        ]);

        // 2. Scan application.properties/yml for spring.messages.basename
        const appProps = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}');
        for (const file of appProps) {
            try {
                const content = await fs.readFile(file.fsPath, 'utf-8');
                let basenames: string[] = [];

                if (file.fsPath.endsWith('.properties')) {
                    const match = content.match(/^\s*spring\.messages\.basename\s*=\s*(.*)$/m);
                    if (match) basenames = match[1].split(',').map(s => s.trim());
                } else {
                    // Simple YAML check
                    const matchColon = content.match(/^\s*spring\.messages\.basename\s*:\s*(.*)$/m);
                    if (matchColon) {
                        basenames = matchColon[1].split(',').map(s => s.trim());
                    }
                }

                for (const basename of basenames) {
                    const normalized = basename.replace(/\./g, '/');
                    // Find files starting with the basename
                    // e.g. i18n/messages -> src/main/resources/i18n/messages*.properties
                    const found = await vscode.workspace.findFiles(`src/main/resources/${normalized}*.{properties,yml,yaml}`);
                    await Promise.all(found.map(processFile));
                }
            } catch (e) {
                Logger.error(`Error parsing application config: ${file.fsPath}`, e);
            }
        }

        this.propertiesCache = newCache;
        this._onDidChange.fire();
        Logger.info(`I18n Properties reloaded. Total locales: ${Object.keys(this.propertiesCache).length}`);
    }

    private async loadSingleFile(uri: vscode.Uri, locale: string, cache: { [locale: string]: CachedProperties }) {
        if (uri.fsPath.endsWith('.properties')) {
            // Async read
            const content = await fs.readFile(uri.fsPath, 'utf8');

            // properties-reader usually reads from file path synchronously. 
            // To be async-friendly, we might want to read content and generic parse, 
            // but properties-reader is robust. 
            // Unfortunately properties-reader main entry point expects a file path or nothing.
            // But it has a .read(string) method on the object.

            let reader = cache[locale]?.reader;
            if (!reader || cache[locale].type !== 'properties') {
                // Create new empty reader
                reader = propertiesReader('');
            }

            // Allow properties-reader to parse the content string
            reader.read(content);

            if (!cache[locale]) {
                cache[locale] = {
                    reader: reader,
                    keySource: new Map(),
                    type: 'properties'
                };
            }

            // Update source map
            reader.each((key: string) => {
                // If the key is new or we are overwriting, map it to this file
                // (Last file loaded wins for same key, which is typical override behavior)
                // However, we want to track where it came from.
                cache[locale].keySource.set(key, uri);
            });

        } else if (uri.fsPath.endsWith('.yml') || uri.fsPath.endsWith('.yaml')) {
            const content = await fs.readFile(uri.fsPath, 'utf8');
            const yamlObj = yaml.load(content) as YamlNode;

            if (!cache[locale]) {
                cache[locale] = {
                    reader: propertiesReader(''), // Dummy reader for consistency if needed? Or custom type.
                    keySource: new Map(),
                    type: 'yaml',
                    yamlObject: yamlObj || {}
                };
            } else if (cache[locale].type === 'yaml') {
                cache[locale].yamlObject = this.deepMerge(cache[locale].yamlObject || {}, yamlObj || {});
            }

            if (cache[locale].type === 'yaml' && yamlObj) {
                const keys = new Set<string>();
                this.collectYamlKeys(yamlObj, '', keys);
                keys.forEach(k => {
                    cache[locale].keySource.set(k, uri);
                });
            }
        }
    }

    public async deleteKey(key: string): Promise<void> {
        Logger.info(`Deleting key: ${key}`);
        const tasks: Promise<void>[] = [];

        for (const locale in this.propertiesCache) {
            const uri = this.getSourceFile(key, locale);
            if (uri) {
                tasks.push(this.deleteKeyFromFile(uri, key));
            }
        }
        await Promise.all(tasks);
        Logger.info(`Deleted key: ${key}`);
        // Consider partial reload instead of full reload? 
        // For now, reload to ensure consistency.
        await this.reloadProperties();
    }

    private async deleteKeyFromFile(uri: vscode.Uri, key: string) {
        // ... (Similar logic to before but maybe optimized?)
        // The previous implementation of deleteKeyFromFile used vscode.workspace.openTextDocument
        // which is fine for manipulation.
        // We will keep using WorkspaceEdit for file modifications to enable Undo.

        if (uri.fsPath.endsWith('.properties')) {
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^\\s*${escapedKey}\\s*=(.*)$`, 'm');
            const match = text.match(regex);

            if (match) {
                const edit = new vscode.WorkspaceEdit();
                const startOffset = match.index!;
                let endOffset = match.index! + match[0].length;

                // Logic to remove newline... preserved from previous code for safety
                // Ideally this should be more robust
                let currentEnd = endOffset;
                while (true) {
                    const subStr = text.substring(startOffset, currentEnd);
                    if (subStr.endsWith('\\')) {
                        const nextNewline = text.indexOf('\n', currentEnd);
                        if (nextNewline !== -1) {
                            currentEnd = nextNewline + 1;
                            const lineEnd = text.indexOf('\n', currentEnd);
                            //... simplifying slightly for logic preservation without bloating
                            const lineContent = text.substring(currentEnd, lineEnd !== -1 ? lineEnd : undefined);
                            currentEnd = lineEnd !== -1 ? lineEnd + 1 : text.length;
                            if (!lineContent.trimEnd().endsWith('\\')) {
                                endOffset = currentEnd;
                                break;
                            }
                        } else {
                            endOffset = text.length;
                            break;
                        }
                    } else {
                        // Check for next newline to remove that too
                        const line = doc.lineAt(doc.positionAt(startOffset));
                        const lineEndRange = line.rangeIncludingLineBreak.end;
                        const lineEndOffset = doc.offsetAt(lineEndRange);
                        if (endOffset < lineEndOffset) {
                            endOffset = lineEndOffset;
                        }
                        break;
                    }
                }

                const startPos = doc.positionAt(startOffset);
                const endPos = doc.positionAt(endOffset);

                edit.delete(uri, new vscode.Range(startPos, endPos));
                await vscode.workspace.applyEdit(edit);
                await doc.save();
            }
        } else if (uri.fsPath.endsWith('.yml') || uri.fsPath.endsWith('.yaml')) {
            // Use simple YAML deletion or re-dump?
            // Re-dumping destroys comments. The previous manual parsing was better for preserving format.
            // I will retain the manual parsing logic but wrap it cleanly.
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const lines = text.split('\n');
            const parts = key.split('.');

            // ... (Previous logic for finding key line)
            const findKeyLine = (startLine: number, keyParts: string[], indent: number): number => {
                if (keyParts.length === 0) return -1;
                const currentKey = keyParts[0];
                const isLast = keyParts.length === 1;

                for (let i = startLine; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;

                    const lineIndent = line.search(/\S/);
                    if (lineIndent < indent) return -1;
                    if (lineIndent > indent) continue;

                    if (lineIndent === indent) {
                        if (trimmed.startsWith(currentKey + ':')) {
                            if (isLast) {
                                return i;
                            } else {
                                let nextIndent = -1;
                                for (let j = i + 1; j < lines.length; j++) {
                                    const nextL = lines[j];
                                    if (nextL.trim() && !nextL.trim().startsWith('#')) {
                                        const ind = nextL.search(/\S/);
                                        if (ind > indent) {
                                            nextIndent = ind;
                                            break;
                                        }
                                        if (ind <= indent) break;
                                    }
                                }
                                if (nextIndent !== -1) {
                                    return findKeyLine(i + 1, keyParts.slice(1), nextIndent);
                                }
                                return -1;
                            }
                        }
                    }
                }
                return -1;
            };

            const keyStartLine = findKeyLine(0, parts, 0);
            if (keyStartLine !== -1) {
                // Also remove children
                const keyIndent = lines[keyStartLine].search(/\S/);
                let keyEndLine = keyStartLine;
                for (let i = keyStartLine + 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line.trim()) continue;
                    const indent = line.search(/\S/);
                    if (indent > keyIndent) {
                        keyEndLine = i;
                    } else {
                        break;
                    }
                }

                const startPos = new vscode.Position(keyStartLine, 0);
                const endPos = new vscode.Position(keyEndLine + 1, 0);

                const edit = new vscode.WorkspaceEdit();
                edit.delete(uri, new vscode.Range(startPos, endPos));
                await vscode.workspace.applyEdit(edit);
                await doc.save();
            }
        }
    }

    public async writeTranslation(key: string, locale: string, value: string): Promise<void> {
        let uri = this.getSourceFile(key, locale);
        if (!uri) {
            const cache = this.propertiesCache[locale];
            if (cache && cache.keySource.size > 0) {
                uri = cache.keySource.values().next().value;
            }
            if (!uri) {
                // Logic to create file
                const createMsg = `Translation file for locale '${locale}' not found. Create a new file?`;
                const createOption = await vscode.window.showWarningMessage(createMsg, 'Yes (properties)', 'Yes (yaml)', 'No');

                if (!createOption || createOption === 'No') {
                    return;
                }
                if (!vscode.workspace.workspaceFolders) return;

                const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const ext = createOption.includes('yaml') ? 'yml' : 'properties';
                const relativePath = `src/main/resources/messages_${locale}.${ext}`;

                const userInput = await vscode.window.showInputBox({
                    prompt: 'Enter file path to create',
                    value: relativePath,
                });
                if (!userInput) return;

                const targetPath = path.join(root, userInput);
                const targetDir = path.dirname(targetPath);

                try {
                    await fs.mkdir(targetDir, { recursive: true });
                    await fs.writeFile(targetPath, '', 'utf8');
                    uri = vscode.Uri.file(targetPath);
                    await this.reloadProperties();
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to create file: ${e.message}`);
                    return;
                }
            }
        }

        if (uri.fsPath.endsWith('.properties')) {
            // Append or replace
            // Using WorkspaceEdit for atomicity and undo
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^\\s*${escapedKey}\\s*=(.*)$`, 'm');
            const match = text.match(regex);

            const edit = new vscode.WorkspaceEdit();

            if (match) {
                const startPos = doc.positionAt(match.index! + match[0].indexOf(match[1]));
                const endPos = doc.positionAt(match.index! + match[0].length);
                edit.replace(uri, new vscode.Range(startPos, endPos), value);
            } else {
                const position = new vscode.Position(doc.lineCount, 0);
                const insertion = text.endsWith('\n') ? `${key}=${value}` : `\n${key}=${value}`;
                edit.insert(uri, position, insertion);
            }
            await vscode.workspace.applyEdit(edit);
            await doc.save();

        } else if (uri.fsPath.endsWith('.yml') || uri.fsPath.endsWith('.yaml')) {
            // Using js-yaml to dump new value? 
            // Or simple parsing?
            // Re-parsing and dumping is safer for structure but loses comments.
            // For now, let's stick to the previous simple logic or use yaml.dump if structure is invalid.
            // The previous code used yaml.dump.
            const content = await fs.readFile(uri.fsPath, 'utf8');
            let obj = yaml.load(content) as YamlNode || {};

            const parts = key.split('.');
            let current = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part] as YamlNode;
            }
            current[parts[parts.length - 1]] = value;

            const newContent = yaml.dump(obj, { indent: 2 });
            await fs.writeFile(uri.fsPath, newContent, 'utf8');
        }

        await this.reloadProperties(); // Refresh cache
    }

    private deepMerge(target: YamlNode, source: YamlNode): YamlNode {
        for (const key of Object.keys(source)) {
            const val = source[key];
            if (val && typeof val === 'object' && key in target) {
                const targetVal = target[key];
                if (targetVal && typeof targetVal === 'object') {
                    Object.assign(source[key] as object, this.deepMerge(targetVal as YamlNode, val as YamlNode));
                }
            }
        }
        return { ...target, ...source };
    }
}
