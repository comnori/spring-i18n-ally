import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';

export class I18nHoverProvider implements vscode.HoverProvider {

    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        const lineText = document.lineAt(position.line).text;
        const pattern = this.getPattern();
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(lineText)) !== null) {
            const key = match[1] || match[0];
            const startChar = match.index;
            const endChar = match.index + match[0].length;

            const range = new vscode.Range(position.line, startChar, position.line, endChar);

            if (range.contains(position)) {
                return this.createHover(key);
            }
        }
        return undefined;
    }

    private createHover(key: string): vscode.Hover {
        const hoverText = new vscode.MarkdownString();
        const args = [key];
        const commandUri = vscode.Uri.parse(
            `command:springI18n.openTranslationEditor?${encodeURIComponent(JSON.stringify(args))}`
        );
        hoverText.appendMarkdown(`**i18n Key:** [\`${key}\`](${commandUri})\n\n`);

        const manager = I18nManager.getInstance();
        let hasTranslation = false;

        // Use a set or sorted list of locales
        const allLocales = Object.keys(manager.propertiesCache).sort();

        for (const locale of allLocales) {
            const value = manager.getTranslation(key, locale);
            if (value) {
                hasTranslation = true;
                const uri = manager.getSourceFile(key, locale);
                let localeStr = `**[${locale}]`;
                if (uri) {
                    const args = [uri];
                    const commandUri = vscode.Uri.parse(
                        `command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`
                    );
                    localeStr += `(${commandUri})`;
                }
                localeStr += `:** ${value}\n\n`;
                hoverText.appendMarkdown(localeStr);
            }
        }

        if (!hasTranslation) {
            const args = [key];
            const commandUri = vscode.Uri.parse(
                `command:springI18n.openTranslationEditor?${encodeURIComponent(JSON.stringify(args))}`
            );
            hoverText.appendMarkdown(`[Add Key...](${commandUri})`);
        }

        hoverText.isTrusted = true;
        return new vscode.Hover(hoverText);
    }

    private getPattern(): RegExp {
        const config = vscode.workspace.getConfiguration('springI18n');
        let rawRegex = config.get<string>('keyRegex') || '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
        try {
            return new RegExp(rawRegex, 'g');
        } catch (e) {
            // console.error(`Invalid regex pattern: ${rawRegex}`, e);
            return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
        }
    }
}
