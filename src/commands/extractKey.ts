import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';

export async function extractI18nKey() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text) {
        vscode.window.showInformationMessage('Please select text to extract.');
        return;
    }

    // Ask for key
    const key = await vscode.window.showInputBox({
        title: 'Extract to i18n Key',
        prompt: 'Enter the property key (e.g. user.greeting)',
        value: generateKeyFromText(text)
    });

    if (!key) return;

    // Ask for locale? Or just default?
    // Usually extracting goes to default locale or all.
    // For simplicity, let's extract to the primary configured locale (first in list)
    const config = vscode.workspace.getConfiguration('springI18n');
    const locales = config.get<string[]>('locales') || ['en'];
    const targetLocale = locales[0];

    // Write to properties
    const manager = I18nManager.getInstance();
    await manager.writeTranslation(key, targetLocale, text);

    // Replace text in editor
    // If quote style needed? usually keys are string literals.
    // Check surrounding quotes?
    // If selected text was "Hello", replace with "key" or "key"?
    // If selected text was inside quotes: "Hello" -> "key"
    // Usually developer selects content inside quotes.
    // We replace it with key.
    // Wait, Spring uses `messages.properties`. In Java code?
    // It depends on usage.
    // If usage is `code("Hello")`, we want `code("key")`.
    // If usage is `@Value("${Hello}")`, we want `@Value("${key}")`.
    // We just replace the selected text with the key. The user is responsible for context.

    await editor.edit(editBuilder => {
        editBuilder.replace(selection, key);
    });

    vscode.window.showInformationMessage(`Extracted '${text}' to '${key}' in ${targetLocale}`);
}

function generateKeyFromText(text: string): string {
    return text.toLowerCase()
        .replace(/[^a-z0-9]/g, '.')
        .replace(/\.+/g, '.')
        .replace(/(^\.|\.$)/g, '');
}
