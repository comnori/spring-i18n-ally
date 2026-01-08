import * as vscode from 'vscode';
import { I18nManager } from '../i18nManager';
import { I18nItem } from '../views/I18nKeyTreeProvider';

export async function editI18nKey(item: I18nItem | string) {
    const key = item instanceof I18nItem ? item.keyPath : item;

    // Determine locale
    const config = vscode.workspace.getConfiguration('springI18n');
    const viewLocale = config.get<string>('viewLocale') || config.get<string[]>('locales')?.[0] || 'en';

    // Get current value
    const manager = I18nManager.getInstance();
    const currentValue = manager.getTranslation(key, viewLocale);

    // Show input box
    const newValue = await vscode.window.showInputBox({
        title: `Edit ${key} (${viewLocale})`,
        value: currentValue || '',
        prompt: 'Enter new translation value'
    });

    if (newValue !== undefined) {
        await manager.writeTranslation(key, viewLocale, newValue);
        vscode.window.showInformationMessage(`Updated ${key}`);
    }
}
