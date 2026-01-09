import * as vscode from 'vscode';
import propertiesReader = require('properties-reader');
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';

// Constants
export interface CachedProperties {
    reader: propertiesReader.Reader;
    // Map key -> source file URI
    keySource: Map<string, vscode.Uri>;
    // Cache YAML content as object for writes
    // Note: properties-reader supports read-only. We might need a unified way to access values if we mix types.
    // For now, I'll assume reader handles properties. For YAML, we need to adapt.
    // properties-reader only supports .properties.
    // We need to abstract the "reader".
    // Let's keep `reader` for .properties and add `yamlContent` for YAML.
    // Or better, make `reader` an interface that both implementations satisfy?
    // properties-reader has specific API.
    // Let's add a `type` field.
    type: 'properties' | 'yaml';
    yamlObject?: any;
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
            if (cache.type === 'properties') {
                return cache.reader.get(key) as string;
            } else if (cache.type === 'yaml' && cache.yamlObject) {
                 // Traverse yamlObject with dot notation
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

    // Get all keys (union of all locales or just all known keys)
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
                        // Mixed types? Usually ignore or handle.
                        // If we have YAML already, we can't easily append properties to it in this structure without merging.
                        // For simplicity, let's assume one format per locale or prioritize one.
                        // Or we can maintain a list of readers?
                        // Given the complexity, let's just log warning.
                        console.warn(`Mixed properties and yaml for locale ${locale} is not fully supported yet.`);
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
                            reader: propertiesReader(''), // Dummy
                            keySource: new Map(),
                            type: 'yaml',
                            yamlObject: yamlObj
                        };
                    } else if (newCache[locale].type === 'yaml') {
                        // Deep merge yaml objects?
                        // For now, overwrite top level or ignore?
                        // Let's do simple Object.assign or deep merge if possible.
                        // Since we don't have deep merge util handy, let's rely on first loaded (Priority)
                        // If we want P1 (loaded first) to win, we don't merge if key exists.
                        // Actually, if we are loading P1 first, we should probably merge P2 INTO P1, overwriting only new keys?
                        // Or if P1 is highest priority, P1 values should stay.
                        // So if we merge, we should merge carefully.
                        // For now, let's just use the first loaded file's object as base and not merge complexly.
                        // Or, better, just support one YAML file per locale for now or assume unique keys.
                    }

                    if (newCache[locale].type === 'yaml') {
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
            } catch (e) {
                console.error(`Failed to load ${uri.fsPath}`, e);
            }
        };

        // Strategy 1: src/main/resources/messages*.{properties,yml,yaml}
        const p1 = await vscode.workspace.findFiles('src/main/resources/messages*.{properties,yml,yaml}');
        p1.forEach(loadFile);

        // Strategy 2: src/main/resources/**/messages*.{properties,yml,yaml}
        const p2 = await vscode.workspace.findFiles('src/main/resources/**/messages*.{properties,yml,yaml}');
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
            // Try to find any file for that locale
            const cache = this.propertiesCache[locale];
            if (cache && cache.keySource.size > 0) {
                 uri = cache.keySource.values().next().value;
            }
            if (!uri) {
                 // If absolutely no file, check if we should create one?
                 // For now error out.
                 vscode.window.showErrorMessage(`No property file found for locale: ${locale}`);
                 return;
            }
        }

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
            // Read, parse, update, dump
            const content = await fs.promises.readFile(uri.fsPath, 'utf8');
            let obj = yaml.load(content) as any || {};

            // Set value deep
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

        // Reload will happen via watcher in extension.ts
    }
}
