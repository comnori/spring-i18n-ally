import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';
import { debounce } from '../utils/debounce';

export class EditorDecorator {
    private static instance: EditorDecorator;
    private decorationType: vscode.TextEditorDecorationType;

    private constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; display: inline-block; width: 0;', // Hide key
            color: 'transparent',
        });
    }

    public static getInstance(): EditorDecorator {
        if (!EditorDecorator.instance) {
            EditorDecorator.instance = new EditorDecorator();
        }
        return EditorDecorator.instance;
    }

    public updateDecorations(editor: vscode.TextEditor) {
        if (!editor || editor.document.languageId !== 'java') {
            return;
        }

        const config = vscode.workspace.getConfiguration('springI18n');
        const priorityLocales = config.get<string[]>('locales') || ['ko', 'en'];
        const viewLocale = config.get<string>('viewLocale');

        let effectiveLocales = priorityLocales;
        if (viewLocale) {
            effectiveLocales = [viewLocale];
        }

        const manager = I18nManager.getInstance();
        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];
        const pattern = this.getPattern();

        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
            const key = match[1] || match[0];
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            // Check intersection with selection
            let isSelected = false;
            for (const selection of editor.selections) {
                if (selection.intersection(range)) {
                    isSelected = true;
                    break;
                }
            }

            if (isSelected) {
                continue;
            }

            let translation = null;
            for (const locale of effectiveLocales) {
                const val = manager.getTranslation(key, locale);
                if (val) {
                    translation = val;
                    break;
                }
            }

            if (!translation && !viewLocale) {
                // Try 'default'
                translation = manager.getTranslation(key, 'default') || null;
            }

            if (translation) {
                const decoration: vscode.DecorationOptions = {
                    range: range,
                    renderOptions: {
                        before: {
                            contentText: `📝 ${translation}`,
                            color: 'inherit',
                            fontStyle: 'italic',
                            margin: '0 8px 0 0'
                        }
                    },
                    hoverMessage: `Original: ${match[0]}`
                };
                decorations.push(decoration);
            }
        }

        editor.setDecorations(this.decorationType, decorations);
    }

    private getPattern(): RegExp {
        const config = vscode.workspace.getConfiguration('springI18n');
        let rawRegex = config.get<string>('keyRegex') || '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
        try {
            return new RegExp(rawRegex, 'g');
        } catch (e) {
            console.error(`Invalid regex pattern: ${rawRegex}`, e);
            return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
        }
    }

    public dispose() {
        this.decorationType.dispose();
    }
}
