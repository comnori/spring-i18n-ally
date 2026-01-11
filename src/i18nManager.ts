import * as vscode from 'vscode';
import propertiesReader = require('properties-reader');
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './utils/Logger';

export interface CachedProperties {
    reader: propertiesReader.Reader;
    keySource: Map<string, vscode.Uri>;
    type: 'properties' | 'yaml';
    yamlObject?: any;
}

export class I18nManager {
    private static instance: I18nManager;
    public propertiesCache: { [locale: string]: CachedProperties } = {};
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private constructor() { }

    public static getInstance(): I18nManager {
        if (!I18nManager.instance) {
            I18nManager.instance = new I18nManager();
        }
        return I18nManager.instance;
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

    private getYamlValue(obj: any, key: string): string | undefined {
        const parts = key.split('.');
        let current = obj;
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
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

    private collectYamlKeys(obj: any, prefix: string, keys: Set<string>) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            const val = obj[key];
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof val === 'object' && val !== null) {
                this.collectYamlKeys(val, fullKey, keys);
            } else {
                keys.add(fullKey);
            }
        }
    }

    public async reloadProperties() {
        if (!vscode.workspace.workspaceFolders) return;

        Logger.info('Reloading properties files...');
        const newCache: { [locale: string]: CachedProperties } = {};
        const loadedFiles = new Set<string>();

        const loadFile = (uri: vscode.Uri) => {
            if (loadedFiles.has(uri.fsPath)) return;

            const filename = path.basename(uri.fsPath);
            let locale = 'default';
            const match = filename.match(/_([a-zA-Z]{2,3}(?:_[a-zA-Z]{2})?)\.(properties|yml|yaml)$/);
            if (match) {
                locale = match[1];
            } else if (filename.endsWith('.properties') || filename.endsWith('.yml') || filename.endsWith('.yaml')) {
                locale = 'default';
            } else {
                return;
            }

            try {
                if (uri.fsPath.endsWith('.properties')) {
                    const props = propertiesReader(uri.fsPath);

                    if (!newCache[locale]) {
                        newCache[locale] = {
                            reader: props,
                            keySource: new Map(),
                            type: 'properties'
                        };
                    } else if (newCache[locale].type === 'properties') {
                        newCache[locale].reader.append(uri.fsPath);
                    } else {
                        Logger.warn(`Mixed properties and yaml for locale ${locale} is not fully supported yet.`);
                    }

                    if (newCache[locale].type === 'properties') {
                        props.each((key: string) => {
                            if (!newCache[locale].keySource.has(key)) {
                                newCache[locale].keySource.set(key, uri);
                            }
                        });
                    }
                } else if (uri.fsPath.endsWith('.yml') || uri.fsPath.endsWith('.yaml')) {
                    const content = fs.readFileSync(uri.fsPath, 'utf8');
                    const yamlObj = yaml.load(content);

                    if (!newCache[locale]) {
                        newCache[locale] = {
                            reader: propertiesReader(''),
                            keySource: new Map(),
                            type: 'yaml',
                            yamlObject: yamlObj || {}
                        };
                    } else if (newCache[locale].type === 'yaml') {
                        newCache[locale].yamlObject = this.deepMerge(newCache[locale].yamlObject, yamlObj || {});
                    }

                    if (newCache[locale].type === 'yaml' && yamlObj) {
                        const keys = new Set<string>();
                        this.collectYamlKeys(yamlObj, '', keys);
                        keys.forEach(k => {
                            if (!newCache[locale].keySource.has(k)) {
                                newCache[locale].keySource.set(k, uri);
                            }
                        });
                    }
                }

                loadedFiles.add(uri.fsPath);
                Logger.info(`Loaded: ${uri.fsPath} (${locale})`);
            } catch (e) {
                Logger.error(`Failed to load ${uri.fsPath}`, e);
            }
        };

        const p1 = await vscode.workspace.findFiles('src/main/resources/messages*.{properties,yml,yaml}');
        p1.forEach(loadFile);

        const p2 = await vscode.workspace.findFiles('src/main/resources/**/messages*.{properties,yml,yaml}');
        p2.forEach(loadFile);

        const appProps = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}');
        for (const file of appProps) {
            try {
                const content = await fs.promises.readFile(file.fsPath, 'utf-8');
                let basenames: string[] = [];
                if (file.fsPath.endsWith('.properties')) {
                    const match = content.match(/^\s*spring\.messages\.basename\s*=\s*(.*)$/m);
                    if (match) basenames = match[1].split(',').map(s => s.trim());
                } else {
                    const matchColon = content.match(/^\s*spring\.messages\.basename\s*:\s*(.*)$/m);
                    if (matchColon) {
                        basenames = matchColon[1].split(',').map(s => s.trim());
                    } else {
                        // Simplify parsing for now
                    }
                }
                for (const basename of basenames) {
                    const normalized = basename.replace(/\./g, '/');
                    const found = await vscode.workspace.findFiles(`src/main/resources/${normalized}*.properties`);
                    found.forEach(loadFile);
                }
            } catch (e) { Logger.error('Error parsing application config', e); }
        }

        const p4 = await vscode.workspace.findFiles('**/message_*.{properties,yml,yaml}');
        p4.forEach(loadFile);
        const p5 = await vscode.workspace.findFiles('**/messages*.{properties,yml,yaml}');
        p5.forEach(loadFile);

        this.propertiesCache = newCache;
        this._onDidChange.fire();
        Logger.info(`I18n Properties reloaded. Total locales: ${Object.keys(this.propertiesCache).length}`);
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
    }

    private async deleteKeyFromFile(uri: vscode.Uri, key: string) {
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

                let currentEnd = endOffset;
                while (true) {
                    const subStr = text.substring(startOffset, currentEnd);
                    if (subStr.endsWith('\\')) {
                        const nextNewline = text.indexOf('\n', currentEnd);
                        if (nextNewline !== -1) {
                            currentEnd = nextNewline + 1;
                            const lineEnd = text.indexOf('\n', currentEnd);
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
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const lines = text.split('\n');
            const parts = key.split('.');

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
            } else {
                Logger.warn(`Could not find key ${key} in YAML file for deletion.`);
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
                const createMsg = `Translation file for locale '${locale}' not found. Create a new file?`;
                const createOption = await vscode.window.showWarningMessage(createMsg, 'Yes (properties)', 'Yes (yaml)', 'No');

                if (!createOption || createOption === 'No') {
                    return;
                }

                if (!vscode.workspace.workspaceFolders) {
                    vscode.window.showErrorMessage('No workspace open.');
                    return;
                }

                const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const ext = createOption.includes('yaml') ? 'yml' : 'properties';

                const relativePath = `src/main/resources/messages_${locale}.${ext}`;

                const userInput = await vscode.window.showInputBox({
                    prompt: 'Enter file path to create',
                    value: relativePath,
                    placeHolder: 'src/main/resources/messages_ko.properties'
                });

                if (!userInput) return;

                const targetPath = path.join(root, userInput);
                const targetDir = path.dirname(targetPath);

                try {
                    await fs.promises.mkdir(targetDir, { recursive: true });
                    await fs.promises.writeFile(targetPath, '', 'utf8');
                    uri = vscode.Uri.file(targetPath);
                    Logger.info(`Created new translation file: ${targetPath}`);
                    await this.reloadProperties();
                } catch (e: any) {
                    const msg = `Failed to create file: ${e.message}`;
                    vscode.window.showErrorMessage(msg);
                    Logger.error(msg);
                    return;
                }
            }
        }

        Logger.info(`Writing translation - Key: ${key}, Locale: ${locale}, Value: ${value}`);

        if (uri.fsPath.endsWith('.properties')) {
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^\\s*${escapedKey}\\s*=(.*)$`, 'm');

            const match = text.match(regex);
            const edit = new vscode.WorkspaceEdit();

            if (match) {
                const fullMatch = match[0];
                const valueMatch = match[1];
                const valueIndex = fullMatch.lastIndexOf(valueMatch);
                const absoluteStartIndex = match.index! + valueIndex;
                const startPos = doc.positionAt(absoluteStartIndex);
                const endPos = doc.positionAt(absoluteStartIndex + valueMatch.length);

                edit.replace(uri, new vscode.Range(startPos, endPos), value);
            } else {
                const position = new vscode.Position(doc.lineCount, 0);
                edit.insert(uri, position, `\n${key}=${value}`);
            }

            await vscode.workspace.applyEdit(edit);
            await doc.save();
        } else if (uri.fsPath.endsWith('.yml') || uri.fsPath.endsWith('.yaml')) {
            const content = await fs.promises.readFile(uri.fsPath, 'utf8');
            let obj = yaml.load(content) as any || {};

            const parts = key.split('.');
            let current = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part];
            }
            current[parts[parts.length - 1]] = value;

            const newContent = yaml.dump(obj, { indent: 2 });
            await fs.promises.writeFile(uri.fsPath, newContent, 'utf8');
        }
    }

    private deepMerge(target: any, source: any): any {
        for (const key of Object.keys(source)) {
            if (source[key] instanceof Object && key in target) {
                Object.assign(source[key], this.deepMerge(target[key], source[key]));
            }
        }
        return { ...target, ...source };
    }
}
